import {
  capabilityInvokeSchema,
  type AgentObservation,
  type AgentPlanRevision,
  type AgentReadableResult,
  type CapabilityId,
  type CapabilityInvokeInput,
  type MicroWorkflowId,
  type WorkflowActionInput,
  type WorkflowActionType,
  type WorkflowRun,
  type WorkflowRunEvent,
  type WorkflowRunStep,
  type WorkflowUiHint
} from "@agent-bridge/shared";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

type WorkflowStepDefinition = {
  id: string;
  label: string;
  detail: string;
  allowedActions: WorkflowActionType[];
  uiHint: WorkflowUiHint;
};

const workflowDefinitions: Record<MicroWorkflowId, WorkflowStepDefinition[]> = {
  isa_subscription_feasibility: [
    {
      id: "review_allowance",
      label: "Review allowance",
      detail: "Check current subscriptions and available ISA allowance.",
      allowedActions: ["advance"],
      uiHint: "allowance_donut"
    },
    {
      id: "choose_amount",
      label: "Choose amount",
      detail: "Record the customer's proposed top-up amount.",
      allowedActions: ["advance"],
      uiHint: "amount_slider"
    },
    {
      id: "confirm_top_up",
      label: "Confirm top-up",
      detail: "Capture explicit customer approval before submission.",
      allowedActions: ["approve"],
      uiHint: "approval_gate"
    }
  ],
  adviser_review_pack_generation: [
    {
      id: "start_pack",
      label: "Start pack",
      detail: "Create a durable queued task for the advised client.",
      allowedActions: ["advance"],
      uiHint: "durable_queue"
    },
    {
      id: "review_drift",
      label: "Review drift",
      detail: "Review model allocation drift and evidence completeness.",
      allowedActions: ["advance"],
      uiHint: "portfolio_drift"
    },
    {
      id: "resolve_exception",
      label: "Resolve exception",
      detail: "Retry the incomplete evidence projection from its checkpoint.",
      allowedActions: ["retry", "advance"],
      uiHint: "retry_checkpoint"
    },
    {
      id: "sign_off",
      label: "Sign off",
      detail: "Record adviser approval before writing to the client record.",
      allowedActions: ["approve"],
      uiHint: "approval_gate"
    }
  ],
  retirement_goal_gap_projection: [
    {
      id: "set_goal",
      label: "Set goal",
      detail: "Record contribution and retirement-age assumptions.",
      allowedActions: ["advance"],
      uiHint: "goal_controls"
    },
    {
      id: "run_projection",
      label: "Run projection",
      detail: "Resume the durable retirement projection from its checkpoint.",
      allowedActions: ["retry", "advance"],
      uiHint: "long_task"
    },
    {
      id: "compare_plan",
      label: "Compare plan",
      detail: "Compare the current path with the adjusted scenario.",
      allowedActions: ["advance"],
      uiHint: "scenario_comparison"
    }
  ]
};

const gapOptionsStep: WorkflowStepDefinition = {
  id: "explore_gap_options",
  label: "Explore options",
  detail: "Compare contribution and retirement-age changes that could close the projected gap.",
  allowedActions: ["advance"],
  uiHint: "gap_options"
};

function readNested(source: Record<string, unknown>, path: string[]) {
  let current: unknown = source;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function readNumber(source: Record<string, unknown>, path: string[], fallback = 0) {
  const raw = readNested(source, path);
  if (typeof raw === "number") return raw;
  const parsed = Number(String(raw ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildPlan(microWorkflowId: MicroWorkflowId, result: AgentReadableResult) {
  const steps = workflowDefinitions[microWorkflowId].map((step) => ({ ...step }));
  let rationale = "The capability result supports the standard controlled workflow.";
  const observations: Array<Omit<AgentObservation, "id" | "timestamp">> = [];

  if (microWorkflowId === "isa_subscription_feasibility") {
    const status = String(readNested(result, ["planned_subscription_check", "status"]) ?? "unknown");
    const remaining = String(result.remaining_allowance ?? "unknown");
    observations.push({
      kind: "business_result",
      summary: `ISA subscription check returned ${status}; remaining allowance is ${remaining}.`,
      evidence: { status, remainingAllowance: remaining }
    });
    rationale = status === "requires_review"
      ? "The requested amount breaches the available allowance, so confirmation must remain blocked until it is adjusted."
      : "The requested amount fits the allowance, so the agent can prepare a confirmation path.";
  }

  if (microWorkflowId === "adviser_review_pack_generation") {
    const driftScore = readNumber(result, ["portfolio_review", "drift_score"]);
    const rebalanceRecommended = Boolean(readNested(result, ["portfolio_review", "rebalance_recommended"]));
    observations.push({
      kind: "business_result",
      summary: `Portfolio drift is ${driftScore}; rebalance recommendation is ${rebalanceRecommended ? "active" : "not required"}.`,
      evidence: { driftScore, rebalanceRecommended }
    });
    if (!rebalanceRecommended && driftScore <= 5) {
      const exceptionIndex = steps.findIndex((step) => step.id === "resolve_exception");
      if (exceptionIndex >= 0) steps.splice(exceptionIndex, 1);
      rationale = "Drift is within threshold, so the agent removed the exception-recovery step.";
    } else {
      rationale = "Drift is above threshold, so the agent added checkpointed evidence recovery before sign-off.";
    }
  }

  if (microWorkflowId === "retirement_goal_gap_projection") {
    const goalProbability = readNumber(result, ["projected_outcome", "goal_probability"]);
    observations.push({
      kind: "business_result",
      summary: `Retirement projection returned a ${goalProbability}% goal probability.`,
      evidence: { goalProbability }
    });
    if (goalProbability < 75) {
      steps.splice(1, 0, { ...gapOptionsStep });
      rationale = "Goal probability is below 75%, so the agent inserted an option-comparison step before the durable projection.";
    } else {
      rationale = "Goal probability is on track, so the agent can proceed directly to the durable projection.";
    }
  }

  return { steps, observations, rationale };
}

const workflowStorePath = fileURLToPath(new URL("../.data/workflow-runs.json", import.meta.url));
const workflowRuns = loadWorkflowRuns();

const mutableInputFields: Record<MicroWorkflowId, Set<string>> = {
  isa_subscription_feasibility: new Set(["plannedIsaSubscription"]),
  adviser_review_pack_generation: new Set(),
  retirement_goal_gap_projection: new Set(["desiredContributionRate", "targetRetirementAge"])
};

function now() {
  return new Date().toISOString();
}

function createObservation(
  runId: string,
  observation: Omit<AgentObservation, "id" | "timestamp">
): AgentObservation {
  return {
    id: `${runId}-OBS-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    timestamp: now(),
    ...observation
  };
}

function createPlanRevision(
  runId: string,
  version: number,
  reason: string,
  addedStepIds: string[],
  removedStepIds: string[]
): AgentPlanRevision {
  return {
    id: `${runId}-PLAN-${version}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    timestamp: now(),
    version,
    reason,
    addedStepIds,
    removedStepIds
  };
}

function updateAgentState(run: WorkflowRun, rationale?: string) {
  const step = run.steps[run.currentStepIndex];
  run.agent.currentActivity = run.status === "completed" ? "Workflow completed" : step?.label ?? "Reviewing outcome";
  run.agent.decisionRationale = rationale ?? run.agent.decisionRationale;
  run.agent.nextAction = run.status === "completed"
    ? "No further action is required."
    : step?.allowedActions.includes("approve")
      ? "Review the evidence and provide explicit approval."
      : step?.allowedActions.includes("retry") && step.attempts === 0
        ? "Resume the failed node from its durable checkpoint."
        : `Continue with ${step?.label ?? "the next workflow step"}.`;
  run.agent.needsUser = Boolean(
    step?.uiHint === "amount_slider" ||
    step?.uiHint === "goal_controls" ||
    step?.uiHint === "gap_options" ||
    step?.allowedActions.includes("approve")
  );
}

function loadWorkflowRuns() {
  const runs = new Map<string, WorkflowRun>();
  if (!existsSync(workflowStorePath)) return runs;
  try {
    const stored = JSON.parse(readFileSync(workflowStorePath, "utf8")) as WorkflowRun[];
    for (const run of stored) {
      if (!run.agent) {
        const planned = buildPlan(run.microWorkflowId, run.result);
        const uiHints = new Map(planned.steps.map((step) => [step.id, step.uiHint]));
        run.steps = run.steps.map((step) => ({
          ...step,
          uiHint: step.uiHint ?? uiHints.get(step.id) ?? "scenario_comparison"
        }));
        run.observations = planned.observations.map((observation) => createObservation(run.id, observation));
        run.planRevisions = [
          createPlanRevision(run.id, 1, planned.rationale, run.steps.map((step) => step.id), [])
        ];
        run.agent = {
          objective: `Complete ${run.microWorkflowId.replaceAll("_", " ")} for the user.`,
          currentActivity: "Restoring durable workflow",
          decisionRationale: planned.rationale,
          nextAction: "Continue from the saved checkpoint.",
          needsUser: false,
          planVersion: 1
        };
        updateAgentState(run);
      }
      runs.set(run.id, run);
    }
  } catch {
    // A damaged POC store should not prevent the gateway from starting.
  }
  return runs;
}

function persistWorkflowRuns() {
  mkdirSync(dirname(workflowStorePath), { recursive: true });
  writeFileSync(workflowStorePath, JSON.stringify([...workflowRuns.values()], null, 2));
}

function createEvent(
  runId: string,
  type: WorkflowRunEvent["type"],
  stepId: string,
  summary: string,
  metadata?: Record<string, unknown>
): WorkflowRunEvent {
  return {
    id: `${runId}-EVT-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    timestamp: now(),
    type,
    summary,
    stepId,
    metadata
  };
}

export function createWorkflowRun(args: {
  microWorkflowId: MicroWorkflowId;
  capabilityId: CapabilityId;
  input: CapabilityInvokeInput;
  result: AgentReadableResult;
}) {
  const createdAt = now();
  const id = `WFR-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const planned = buildPlan(args.microWorkflowId, args.result);
  const steps: WorkflowRunStep[] = planned.steps.map((step, index) => ({
    ...step,
    status: index === 0 ? "requires_action" : "waiting",
    attempts: 0,
    updatedAt: createdAt
  }));
  const observations = planned.observations.map((observation) => createObservation(id, observation));
  const initialRevision = createPlanRevision(id, 1, planned.rationale, steps.map((step) => step.id), []);
  const run: WorkflowRun = {
    id,
    microWorkflowId: args.microWorkflowId,
    capabilityId: args.capabilityId,
    status: "active",
    currentStepIndex: 0,
    steps,
    input: args.input,
    result: args.result,
    auditTraceId: args.result.audit_trace_id,
    createdAt,
    updatedAt: createdAt,
    agent: {
      objective: `Complete ${args.microWorkflowId.replaceAll("_", " ")} for the user.`,
      currentActivity: steps[0].label,
      decisionRationale: planned.rationale,
      nextAction: `Continue with ${steps[0].label}.`,
      needsUser: false,
      planVersion: 1
    },
    observations,
    planRevisions: [initialRevision],
    events: [
      createEvent(id, "run.created", steps[0].id, `Created ${args.microWorkflowId} workflow run.`),
      ...observations.map((observation) =>
        createEvent(id, "observation.recorded", steps[0].id, observation.summary, observation.evidence)
      ),
      createEvent(id, "plan.revised", steps[0].id, planned.rationale, {
        version: 1,
        addedStepIds: initialRevision.addedStepIds
      })
    ]
  };
  updateAgentState(run, planned.rationale);
  workflowRuns.set(id, run);
  persistWorkflowRuns();
  return run;
}

export function getWorkflowRun(runId: string) {
  return workflowRuns.get(runId);
}

function revisePlan(
  run: WorkflowRun,
  reason: string,
  addedStepIds: string[] = [],
  removedStepIds: string[] = []
) {
  run.agent.planVersion += 1;
  const revision = createPlanRevision(
    run.id,
    run.agent.planVersion,
    reason,
    addedStepIds,
    removedStepIds
  );
  run.planRevisions.push(revision);
  run.events.push(
    createEvent(run.id, "plan.revised", run.steps[run.currentStepIndex]?.id ?? "workflow", reason, {
      version: revision.version,
      addedStepIds,
      removedStepIds
    })
  );
  updateAgentState(run, reason);
}

function createRunStep(definition: WorkflowStepDefinition, status: WorkflowRunStep["status"]): WorkflowRunStep {
  return {
    ...definition,
    status,
    attempts: 0,
    updatedAt: now()
  };
}

function observeResultAndReplan(run: WorkflowRun, result: AgentReadableResult) {
  if (run.microWorkflowId === "isa_subscription_feasibility") {
    const status = String(readNested(result, ["planned_subscription_check", "status"]) ?? "unknown");
    const plannedAmount = String(readNested(result, ["planned_subscription_check", "planned_subscription"]) ?? "unknown");
    const observation = createObservation(run.id, {
      kind: "business_result",
      summary: `The refreshed ISA check returned ${status} for ${plannedAmount}.`,
      evidence: { status, plannedAmount, auditTraceId: result.audit_trace_id }
    });
    run.observations.push(observation);
    run.events.push(
      createEvent(run.id, "observation.recorded", run.steps[run.currentStepIndex]?.id ?? "workflow", observation.summary, observation.evidence)
    );
    if (status === "requires_review" && run.steps[run.currentStepIndex]?.id === "confirm_top_up") {
      const amountIndex = run.steps.findIndex((step) => step.id === "choose_amount");
      const confirmIndex = run.steps.findIndex((step) => step.id === "confirm_top_up");
      if (amountIndex >= 0 && confirmIndex >= 0) {
        run.steps[amountIndex].status = "requires_action";
        run.steps[confirmIndex].status = "waiting";
        run.currentStepIndex = amountIndex;
        run.status = "active";
        revisePlan(
          run,
          `${plannedAmount} exceeds the available ISA allowance, so the agent returned to amount selection and blocked confirmation.`
        );
      }
    } else {
      updateAgentState(run, `${plannedAmount} passed the refreshed allowance check; confirmation can remain in the plan.`);
    }
  }

  if (run.microWorkflowId === "retirement_goal_gap_projection") {
    const probability = readNumber(result, ["projected_outcome", "goal_probability"]);
    const observation = createObservation(run.id, {
      kind: "business_result",
      summary: `The refreshed retirement projection returned a ${probability}% goal probability.`,
      evidence: {
        goalProbability: probability,
        contributionRate: run.input.desiredContributionRate,
        targetRetirementAge: run.input.targetRetirementAge,
        auditTraceId: result.audit_trace_id
      }
    });
    run.observations.push(observation);
    run.events.push(
      createEvent(run.id, "observation.recorded", run.steps[run.currentStepIndex]?.id ?? "workflow", observation.summary, observation.evidence)
    );

    const gapIndex = run.steps.findIndex((step) => step.id === gapOptionsStep.id);
    const projectionIndex = run.steps.findIndex((step) => step.id === "run_projection");
    if (probability >= 75 && gapIndex >= 0 && run.steps[gapIndex].status !== "completed") {
      run.steps.splice(gapIndex, 1);
      const nextProjectionIndex = run.steps.findIndex((step) => step.id === "run_projection");
      run.currentStepIndex = nextProjectionIndex;
      run.steps[nextProjectionIndex].status = "requires_action";
      revisePlan(
        run,
        `Goal probability improved to ${probability}%, so the agent removed the unnecessary option-comparison step.`,
        [],
        [gapOptionsStep.id]
      );
    } else if (probability < 75 && gapIndex < 0 && projectionIndex >= 0) {
      run.steps.splice(projectionIndex, 0, createRunStep(gapOptionsStep, "requires_action"));
      run.currentStepIndex = projectionIndex;
      run.steps[projectionIndex + 1].status = "waiting";
      revisePlan(
        run,
        `Goal probability fell to ${probability}%, so the agent inserted an option-comparison step before projection.`,
        [gapOptionsStep.id]
      );
    } else {
      updateAgentState(
        run,
        probability < 75
          ? `The ${probability}% result still shows a goal gap; option comparison remains necessary.`
          : `The ${probability}% result remains on track.`
      );
    }
  }

  if (run.microWorkflowId === "adviser_review_pack_generation") {
    const driftScore = readNumber(result, ["portfolio_review", "drift_score"]);
    const observation = createObservation(run.id, {
      kind: "business_result",
      summary: `Evidence refresh retained a portfolio drift score of ${driftScore}.`,
      evidence: { driftScore, auditTraceId: result.audit_trace_id }
    });
    run.observations.push(observation);
    run.events.push(
      createEvent(run.id, "observation.recorded", run.steps[run.currentStepIndex]?.id ?? "workflow", observation.summary, observation.evidence)
    );
    updateAgentState(run, `The evidence node recovered successfully; the ${driftScore} drift score still requires adviser sign-off.`);
  }
}

export function updateWorkflowRunResult(runId: string, result: AgentReadableResult) {
  const run = workflowRuns.get(runId);
  if (!run) return undefined;
  run.result = result;
  run.auditTraceId = result.audit_trace_id;
  run.updatedAt = now();
  observeResultAndReplan(run, result);
  persistWorkflowRuns();
  return run;
}

export function applyWorkflowAction(runId: string, input: WorkflowActionInput) {
  const run = workflowRuns.get(runId);
  if (!run) return { error: "Workflow run not found", status: 404 } as const;
  if (run.status === "completed") return { error: "Workflow run is already completed", status: 409 } as const;

  const step = run.steps[run.currentStepIndex];
  if (!step || step.id !== input.stepId) {
    return { error: `Action must target current step ${step?.id ?? "unknown"}`, status: 409 } as const;
  }
  if (!step.allowedActions.includes(input.action)) {
    return { error: `${input.action} is not allowed for step ${step.id}`, status: 409 } as const;
  }

  if (input.payload) {
    const invalidField = Object.keys(input.payload).find(
      (field) => !mutableInputFields[run.microWorkflowId].has(field)
    );
    if (invalidField) {
      return { error: `${invalidField} cannot be changed in ${run.microWorkflowId}`, status: 400 } as const;
    }
    const parsedInput = capabilityInvokeSchema.safeParse({ ...run.input, ...input.payload });
    if (!parsedInput.success) {
      return { error: "Workflow action payload is invalid", status: 400, issues: parsedInput.error.issues } as const;
    }
    run.input = parsedInput.data;
    const observation = createObservation(run.id, {
      kind: "user_input",
      summary: `User updated ${Object.keys(input.payload).join(" and ")}.`,
      evidence: input.payload
    });
    run.observations.push(observation);
    run.events.push(createEvent(run.id, "observation.recorded", step.id, observation.summary, observation.evidence));
  }

  const updatedAt = now();
  if (input.action === "retry") {
    step.attempts += 1;
    step.status = "requires_action";
    step.detail = `Recovered from checkpoint on attempt ${step.attempts}. Successful upstream results were retained.`;
    step.updatedAt = updatedAt;
    run.updatedAt = updatedAt;
    run.events.push(
      createEvent(run.id, "step.retried", step.id, `Retried ${step.label} from its durable checkpoint.`, {
        attempt: step.attempts
      })
    );
    updateAgentState(run, `The agent recovered ${step.label} from checkpoint without repeating completed upstream work.`);
    persistWorkflowRuns();
    return { run } as const;
  }

  step.status = "completed";
  step.updatedAt = updatedAt;
  run.events.push(
    createEvent(
      run.id,
      input.action === "approve" ? "approval.recorded" : "step.advanced",
      step.id,
      input.action === "approve" ? `Approval recorded for ${step.label}.` : `Completed ${step.label}.`,
      input.payload
    )
  );

  const nextStep = run.steps[run.currentStepIndex + 1];
  if (nextStep) {
    run.currentStepIndex += 1;
    nextStep.status = "requires_action";
    nextStep.updatedAt = updatedAt;
    run.status = nextStep.allowedActions.includes("approve") ? "waiting_for_human" : "active";
  } else {
    run.status = "completed";
    run.events.push(createEvent(run.id, "run.completed", step.id, `${run.microWorkflowId} completed.`));
  }
  run.updatedAt = updatedAt;
  updateAgentState(
    run,
    input.action === "approve"
      ? `Human approval was recorded for ${step.label}; the agent can safely complete the workflow.`
      : `The agent completed ${step.label} and selected the next required action.`
  );
  persistWorkflowRuns();
  return { run } as const;
}
