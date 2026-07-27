import { loadLocalEnv } from "./env.js";
import cors from "cors";
import express from "express";
import {
  type ActiveWorkflowTurn,
  type AgentReadableResult,
  type CapabilityId,
  capabilityInvokeSchema,
  microWorkflowIds,
  type WorkflowTurnInterpretation,
  workflowActionSchema,
  type MicroWorkflowId
} from "@agent-bridge/shared";
import { getAuditEvents, getAuditRecord, getAuditRecordByRequestId } from "./audit.js";
import { capabilities, getCapability } from "./catalog.js";
import { getCapabilityPackage, type InputContractField, type InputExtractor } from "./capabilityPackages.js";
import {
  composeAdviserModelPortfolioReview,
  composeIsaAllowanceReview,
  composeRetirementPensionTaskOrchestration,
  composeSippDrawdownPathwayReview,
  composeWorkplacePensionContributionGuidance
} from "./composers.js";
import { resolveIntent } from "./intent.js";
import { isLlmIntentResolverConfigured } from "./llmIntentResolver.js";
import { getMcpSession, listMcpSessions, recordMcpStep } from "./mcpSessions.js";
import {
  applyWorkflowAction,
  createWorkflowRun,
  getWorkflowRun,
  updateWorkflowRunResult
} from "./workflowRuns.js";

loadLocalEnv();

const app = express();
const port = Number(process.env.PORT ?? 4100);

app.use(cors());
app.use(express.json());

function extractLatestUserRequest(prompt: string) {
  const marker = "Latest user request:";
  const index = prompt.lastIndexOf(marker);
  if (index < 0) return prompt;
  const latest = prompt.slice(index + marker.length).trim();
  return latest || prompt;
}

function isCancellationFollowUp(prompt: string) {
  return /(?:不取了|不提取了|不想取了|不想提取了|先不取|暂不取|取消|算了|不用了)/iu.test(prompt);
}

function enrichRoutingPromptFromBody(prompt: string, body: Record<string, unknown>) {
  if (body.microWorkflowId !== "retirement_pension_task_orchestration") return prompt;
  if (isCancellationFollowUp(prompt)) return prompt;
  if (/(?:公积金|住房公积金|养老金|退休)/iu.test(prompt)) return prompt;

  if (body.pensionTaskIntent === "cash_access_exploration") {
    return `在当前公积金提取任务中，${prompt}`;
  }
  if (body.pensionTaskIntent === "retirement_claim_planning") {
    return `在当前养老金退休规划任务中，${prompt}`;
  }
  if (body.pensionTaskIntent === "pot_composition") {
    return `在当前养老金账户构成任务中，${prompt}`;
  }
  return prompt;
}

function parseActiveWorkflowTurn(value: unknown): ActiveWorkflowTurn | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.workflowId !== "string") return null;
  if (typeof record.microWorkflowId !== "string" || !microWorkflowIds.includes(record.microWorkflowId as MicroWorkflowId)) return null;
  if (typeof record.capabilityId !== "string") return null;
  if (!record.currentInput || typeof record.currentInput !== "object") return null;
  return {
    workflowId: record.workflowId,
    microWorkflowId: record.microWorkflowId as MicroWorkflowId,
    capabilityId: record.capabilityId as CapabilityId,
    currentInput: record.currentInput as ActiveWorkflowTurn["currentInput"],
    workflowRunId: typeof record.workflowRunId === "string" ? record.workflowRunId : undefined
  };
}

function interpretActiveWorkflowTurn(prompt: string, activeWorkflow: ActiveWorkflowTurn | null): WorkflowTurnInterpretation | null {
  if (!activeWorkflow) return null;
  const lower = prompt.toLowerCase();
  const explicitSwitchSignals = [
    "isa",
    "sipp",
    "adviser",
    "advisor",
    "portfolio",
    "退休规划",
    "账户构成",
    "什么时候退休"
  ];
  const isSwitch = explicitSwitchSignals.some((signal) => lower.includes(signal)) &&
    activeWorkflow.microWorkflowId === "retirement_pension_task_orchestration" &&
    !/(?:两万|2万|二万|¥|公积金|提取|不取|取消)/iu.test(prompt);
  if (isSwitch) {
    return {
      dialogueAct: "switch_task",
      confidence: 0.72,
      reasoning: "The user appears to be changing away from the active workflow, so global routing should decide the next capability.",
      shouldInvokeCapability: false,
      shouldUseGlobalRouter: true
    };
  }

  if (isCancellationFollowUp(prompt)) {
    return {
      dialogueAct: "cancel_task",
      confidence: 0.92,
      reasoning: "The turn declines or cancels the active workflow rather than requesting a new capability.",
      shouldInvokeCapability: false,
      shouldUseGlobalRouter: false
    };
  }

  if (activeWorkflow.microWorkflowId === "retirement_pension_task_orchestration") {
    const amount = extractWithdrawalAmountFromPrompt(prompt);
    if (Number.isFinite(amount)) {
      return {
        dialogueAct: "update_parameter",
        confidence: 0.88,
        reasoning: "The user updated the requested withdrawal amount inside the active pension workflow.",
        shouldInvokeCapability: true,
        shouldUseGlobalRouter: false,
        extractedParameters: { requestedWithdrawalAmount: amount }
      };
    }
  }

  return {
    dialogueAct: "ask_question",
    confidence: 0.55,
    reasoning: "The turn belongs to the active workflow but does not mutate a governed input.",
    shouldInvokeCapability: false,
    shouldUseGlobalRouter: false
  };
}

function extractWithdrawalAmountFromPrompt(prompt: string) {
  const match = prompt.match(
    /[£¥]\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?|(\d+(?:\.\d+)?)\s*(?:万|萬元|万元)|([一二两三四五六七八九十]+)\s*(?:万|萬元|万元)|\b(\d{4,7})\b/
  );
  const chineseWan = match?.[3];
  if (chineseWan) {
    const parsed = parseSmallChineseNumber(chineseWan);
    return Number.isFinite(parsed) ? parsed * 10000 : undefined;
  }
  const raw = match?.[1] ?? match?.[2] ?? match?.[4];
  if (!raw) return undefined;
  const value = Number(raw.replaceAll(",", ""));
  if (!Number.isFinite(value)) return undefined;
  return match?.[2] ? value * 10000 : value;
}

function createWorkflowTurnResult(
  activeWorkflow: ActiveWorkflowTurn,
  interpretation: WorkflowTurnInterpretation
): AgentReadableResult {
  const isPension = activeWorkflow.microWorkflowId === "retirement_pension_task_orchestration";
  const summary = interpretation.dialogueAct === "cancel_task"
    ? "已停止本次公积金提取探索；没有提交申请，也没有调用资金办理接口。"
    : "我已记录这条消息；当前工作流没有需要重新测算的输入变化。";
  return {
    capability: activeWorkflow.capabilityId,
    workflow_id: activeWorkflow.microWorkflowId,
    sub_intent: activeWorkflow.currentInput.pensionTaskIntent ?? "cash_access_exploration",
    composition_mode: "active_workflow_turn_interpretation",
    workflow_state: {
      status: interpretation.dialogueAct === "cancel_task" ? "cancelled" : "paused",
      dialogue_act: interpretation.dialogueAct,
      reasoning: interpretation.reasoning
    },
    task_plan: isPension
      ? [
          {
            id: "WorkflowTurnSummary",
            title: interpretation.dialogueAct === "cancel_task" ? "已停止当前任务" : "当前任务已暂停",
            source: "workflow_state",
            microWorkflow: "active_workflow_turn_interpretation",
            component: "WorkflowState"
          }
        ]
      : [],
    next_actions: interpretation.dialogueAct === "cancel_task"
      ? [{ action: "restart_workflow", recommended: true }]
      : [],
    summary,
    source_apis: [],
    policy_checks: [
      {
        name: "active_workflow_dialogue_act",
        status: "completed",
        detail: interpretation.reasoning
      }
    ],
    audit_trace_id: `WORKFLOW-TURN-${Date.now()}`
  };
}

app.get("/", (_req, res) => {
  res.json({
    service: "gateway",
    status: "ok",
    message: "Agent-Bridge capability gateway is running.",
    endpoints: {
      health: "/health",
      capabilities: "/capabilities",
      resolveIntent: "POST /intent/resolve",
      agentRequest: "POST /agent/request",
      aguiRuns: "POST /agui/runs",
      workflowRuns: "GET /workflow-runs/:runId",
      workflowActions: "POST /workflow-runs/:runId/actions",
      invokeCapability: "POST /capabilities/:capabilityId/invoke",
      audit: "/audit/:traceId"
      ,
      mcpSessions: "/mcp/sessions"
    },
    demo: "http://localhost:4102",
    mcp: {
      transport: "stdio",
      server: "apps/mcp-server/dist/server.js",
      appResource: "ui://agent-bridge/app.html"
    }
  });
});

app.get("/health", (_req, res) => {
  res.json({
    service: "gateway",
    status: "ok",
    interface: "real-mcp-server-adapter",
    intentResolver: isLlmIntentResolverConfigured() ? "semantic+llm-adjudication" : "semantic+rules"
  });
});

app.get("/capabilities", (_req, res) => {
  res.json({
    interface: "governed-capability-gateway",
    contractModel: {
      purpose: "Publish configured, governed business capabilities over existing value-stream APIs.",
      lifecycle: ["draft", "active", "deprecated"],
      routeIndex: "catalog metadata + examples + local semantic vectors + optional LLM adjudication",
      auditModel: "append-only invocation events, currently in-memory for the POC"
    },
    capabilities: capabilities.map((capability) => ({
      ...capability,
      package: getCapabilityPackage(capability.id)
    }))
  });
});

app.get("/capabilities/:capabilityId/contract", (req, res) => {
  const capability = getCapability(req.params.capabilityId);
  if (!capability) {
    res.status(404).json({ error: "Unknown capability" });
    return;
  }

  res.json({
    contract: capability,
    package: getCapabilityPackage(capability.id),
    enterpriseReadiness: {
      configuredExecution: capability.executionPlan.steps.length,
      policyControls: capability.policy,
      dataClassification: capability.dataClassification,
      routeSignals: {
        domains: capability.routing.domains,
        positiveExamples: capability.routing.positiveExamples.length,
        negativeExamples: capability.routing.negativeExamples.length
      }
    }
  });
});

app.post("/intent/resolve", async (req, res, next) => {
  try {
    const prompt = String(req.body?.prompt ?? "");
    if (!prompt.trim()) {
      res.status(400).json({ error: "prompt is required" });
      return;
    }

    res.json(await resolveIntent(prompt));
  } catch (error) {
    next(error);
  }
});

app.post("/capabilities/:capabilityId/invoke", async (req, res, next) => {
  try {
    const capability = getCapability(req.params.capabilityId);
    if (!capability) {
      res.status(404).json({ error: "Unknown capability" });
      return;
    }

    const parsed = capabilityInvokeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid capability input", issues: parsed.error.issues });
      return;
    }

    res.json(await composeCapability(capability, parsed.data));
  } catch (error) {
    next(error);
  }
});

app.post("/agent/request", async (req, res, next) => {
  try {
    const prompt = String(req.body?.prompt ?? "");
    if (!prompt.trim()) {
      res.status(400).json({ error: "prompt is required" });
      return;
    }
    const routingPrompt = enrichRoutingPromptFromBody(extractLatestUserRequest(prompt), req.body ?? {});

    const scopeDecision = evaluateCustomerScope(routingPrompt, String(req.body?.customerId ?? ""));
    if (scopeDecision) {
      res.json({
        prompt: routingPrompt,
        resolution: scopeDecision
      });
      return;
    }

    const resolution = await resolveIntent(routingPrompt);

    if (resolution.status !== "resolved" || !resolution.capabilityId) {
      res.json({
        prompt: routingPrompt,
        resolution
      });
      return;
    }

    const capability = getCapability(resolution.capabilityId);
    if (!capability) {
      res.status(500).json({ error: "Resolved capability was not found" });
      return;
    }

    const parsed = capabilityInvokeSchema.safeParse(
      buildCapabilityInput(capability, req.body ?? {}, prompt)
    );
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request input", issues: parsed.error.issues });
      return;
    }

    const result = await composeCapability(capability, parsed.data);

    res.json({
      prompt: routingPrompt,
      resolution,
      capability,
      result
    });
  } catch (error) {
    next(error);
  }
});

app.post("/agui/runs", async (req, res, next) => {
  try {
    const prompt = String(req.body?.prompt ?? "");
    if (!prompt.trim()) {
      res.status(400).json({ error: "prompt is required" });
      return;
    }
    const routingPrompt = enrichRoutingPromptFromBody(extractLatestUserRequest(prompt), req.body ?? {});

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });

    const runId = `AGUI-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    writeAguiEvent(res, {
      type: "RUN_STARTED",
      label: "Run started",
      detail: "Web agent interaction opened against the governed capability gateway.",
      status: "running",
      runId,
      state: { prompt }
    });
    writeAguiEvent(res, {
      type: "MESSAGES_SNAPSHOT",
      label: "User message captured",
      detail: prompt,
      status: "completed",
      runId
    });
    writeAguiEvent(res, {
      type: "STATE_DELTA",
      label: "Customer scope check",
      detail: "Checking active customer context before intent routing.",
      status: "running",
      runId
    });

    const scopeDecision = evaluateCustomerScope(routingPrompt, String(req.body?.customerId ?? ""));
    if (scopeDecision) {
      const response = {
        prompt: routingPrompt,
        resolution: scopeDecision
      };
      writeAguiEvent(res, {
        type: "STATE_DELTA",
        label: "Scope denied",
        detail: scopeDecision.reasoning,
        status: "blocked",
        runId,
        state: { resolution: scopeDecision }
      });
      writeAguiEvent(res, {
        type: "CUSTOM",
        label: "A2UI boundary surface",
        detail: "The response shape maps to a policy-boundary UI surface.",
        status: "blocked",
        runId,
        state: { presentationHint: "policy_boundary" }
      });
      writeAguiEvent(res, {
        type: "RUN_FINISHED",
        label: "Run finished",
        detail: "The run stopped before downstream API invocation.",
        status: "blocked",
        runId,
        response
      });
      res.end();
      return;
    }

    const activeWorkflow = parseActiveWorkflowTurn(req.body?.activeWorkflow);
    const workflowTurn = interpretActiveWorkflowTurn(routingPrompt, activeWorkflow);
    if (workflowTurn && !workflowTurn.shouldUseGlobalRouter) {
      writeAguiEvent(res, {
        type: "STATE_DELTA",
        label: "Active workflow turn",
        detail: workflowTurn.reasoning,
        status: "completed",
        runId,
        state: { interpretation: workflowTurn, activeWorkflow }
      });

      if (!workflowTurn.shouldInvokeCapability && activeWorkflow) {
        const capability = getCapability(activeWorkflow.capabilityId);
        const result = createWorkflowTurnResult(activeWorkflow, workflowTurn);
        const response = {
          prompt: routingPrompt,
          resolution: {
            status: "resolved" as const,
            intent: `active workflow ${workflowTurn.dialogueAct}`,
            capabilityId: activeWorkflow.capabilityId,
            confidence: workflowTurn.confidence,
            reasoning: workflowTurn.reasoning,
            resolver: "workflow_turn" as const
          },
          capability,
          result
        };
        writeAguiEvent(res, {
          type: "CUSTOM",
          label: "Workflow state surface",
          detail: result.summary,
          status: workflowTurn.dialogueAct === "cancel_task" ? "blocked" : "completed",
          runId,
          state: {
            presentationHint: "active_workflow_turn",
            dialogueAct: workflowTurn.dialogueAct
          }
        });
        writeAguiEvent(res, {
          type: "RUN_FINISHED",
          label: "Run finished",
          detail: result.summary,
          status: "completed",
          runId,
          response
        });
        res.end();
        return;
      }

      if (workflowTurn.shouldInvokeCapability && activeWorkflow) {
        const capability = getCapability(activeWorkflow.capabilityId);
        if (!capability) throw new Error("Active workflow capability was not found");
        const parsed = capabilityInvokeSchema.safeParse({
          ...activeWorkflow.currentInput,
          ...workflowTurn.extractedParameters
        });
        if (!parsed.success) {
          writeAguiEvent(res, {
            type: "RUN_ERROR",
            label: "Invalid workflow turn input",
            detail: "The active workflow rejected the interpreted input update.",
            status: "blocked",
            runId,
            state: { issues: parsed.error.issues, interpretation: workflowTurn }
          });
          res.end();
          return;
        }
        writeAguiEvent(res, {
          type: "TOOL_CALL_START",
          label: "Capability invocation",
          detail: `Re-invoking ${capability.id} from active workflow state.`,
          status: "running",
          runId,
          state: {
            capabilityId: capability.id,
            interpretation: workflowTurn,
            inputPatch: workflowTurn.extractedParameters
          }
        });
        const result = await composeCapability(capability, parsed.data);
        const workflowRun = createWorkflowRun({
          microWorkflowId: activeWorkflow.microWorkflowId,
          capabilityId: capability.id,
          input: parsed.data,
          result
        });
        const response = {
          prompt: routingPrompt,
          resolution: {
            status: "resolved" as const,
            intent: "active workflow parameter update",
            capabilityId: capability.id,
            confidence: workflowTurn.confidence,
            reasoning: workflowTurn.reasoning,
            resolver: "workflow_turn" as const
          },
          capability,
          result,
          workflowRun
        };
        writeAguiEvent(res, {
          type: "TOOL_CALL_END",
          label: "Capability result",
          detail: `${result.source_apis.length} governed source APIs composed from active workflow state.`,
          status: "completed",
          runId,
          state: {
            sourceApis: result.source_apis,
            policyChecks: result.policy_checks,
            auditTraceId: result.audit_trace_id,
            workflowRunId: workflowRun.id
          }
        });
        writeAguiEvent(res, {
          type: "RUN_FINISHED",
          label: "Run finished",
          detail: `Workflow turn handled as ${workflowTurn.dialogueAct}.`,
          status: "completed",
          runId,
          response
        });
        res.end();
        return;
      }
    }

    writeAguiEvent(res, {
      type: "STATE_DELTA",
      label: "Intent analysis",
      detail: "Running policy guard, rules guard, semantic router, and optional LLM adjudication.",
      status: "running",
      runId
    });
    const resolution = await resolveIntent(routingPrompt);
    writeAguiEvent(res, {
      type: "STATE_DELTA",
      label: "Capability match",
      detail: resolution.reasoning,
      status: resolution.status === "resolved" ? "completed" : "blocked",
      runId,
      state: {
        resolution,
        routingTrace: resolution.routingTrace ?? []
      }
    });

    if (resolution.status !== "resolved" || !resolution.capabilityId) {
      const response = {
        prompt: routingPrompt,
        resolution
      };
      writeAguiEvent(res, {
        type: "CUSTOM",
        label: "A2UI decision surface",
        detail: "The response shape maps to clarification, unsupported, or governance UI.",
        status: "blocked",
        runId,
        state: { presentationHint: resolution.status }
      });
      writeAguiEvent(res, {
        type: "RUN_FINISHED",
        label: "Run finished",
        detail: "No governed capability was invoked.",
        status: "blocked",
        runId,
        response
      });
      res.end();
      return;
    }

    const capability = getCapability(resolution.capabilityId);
    if (!capability) {
      throw new Error("Resolved capability was not found");
    }

    writeAguiEvent(res, {
      type: "TOOL_CALL_START",
      label: "Capability invocation",
      detail: `Invoking ${capability.id}.`,
      status: "running",
      runId,
      state: {
        capabilityId: capability.id,
        requiredApis: capability.requiredApis
      }
    });

    const parsed = capabilityInvokeSchema.safeParse(
      buildCapabilityInput(capability, req.body ?? {}, prompt)
    );
    if (!parsed.success) {
      writeAguiEvent(res, {
        type: "RUN_ERROR",
        label: "Invalid request input",
        detail: "The resolved capability rejected the supplied input shape.",
        status: "blocked",
        runId,
        state: { issues: parsed.error.issues }
      });
      res.end();
      return;
    }

    const result = await composeCapability(capability, parsed.data);
    const microWorkflowId = resolveMicroWorkflowId(req.body ?? {}, result);
    const workflowRun = microWorkflowId
      ? createWorkflowRun({
          microWorkflowId,
          capabilityId: capability.id,
          input: parsed.data,
          result
        })
      : undefined;
    const response = {
      prompt: routingPrompt,
      resolution,
      capability,
      result,
      workflowRun
    };

    writeAguiEvent(res, {
      type: "TOOL_CALL_END",
      label: "Capability result",
      detail: `${result.source_apis.length} governed source APIs composed.`,
      status: "completed",
      runId,
      state: {
        sourceApis: result.source_apis,
        policyChecks: result.policy_checks,
        auditTraceId: result.audit_trace_id
      }
    });
    writeAguiEvent(res, {
      type: "CUSTOM",
      label: "A2UI surface update",
      detail: "The final governed result can now be rendered as typed UI components.",
      status: "completed",
      runId,
      state: {
        presentationHint: capability.id,
        outputKeys: Object.keys(result),
        workflowRunId: workflowRun?.id,
        microWorkflowId: workflowRun?.microWorkflowId
      }
    });
    writeAguiEvent(res, {
      type: "RUN_FINISHED",
      label: "Run finished",
      detail: result.audit_trace_id
        ? `Audit trace ${result.audit_trace_id} linked.`
        : "Run completed.",
      status: "completed",
      runId,
      response
    });
    res.end();
  } catch (error) {
    if (res.headersSent) {
      writeAguiEvent(res, {
        type: "RUN_ERROR",
        label: "Run failed",
        detail: error instanceof Error ? error.message : String(error),
        status: "blocked"
      });
      res.end();
      return;
    }
    next(error);
  }
});

function writeAguiEvent(
  res: express.Response,
  event: {
    type: string;
    label: string;
    detail: string;
    status: "running" | "completed" | "blocked";
    runId?: string;
    state?: Record<string, unknown>;
    response?: unknown;
  }
) {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify({ id: `${event.type}-${Date.now()}`, timestamp: new Date().toISOString(), ...event })}\n\n`);
}

type ParsedCapabilityInput = ReturnType<typeof capabilityInvokeSchema.parse>;

async function composeCapability(capability: NonNullable<ReturnType<typeof getCapability>>, input: ParsedCapabilityInput) {
  switch (capability.id) {
    case "personal_investing_isa_allowance_review":
      return composeIsaAllowanceReview(capability, input);
    case "sipp_drawdown_pathway_review":
      return composeSippDrawdownPathwayReview(capability, input);
    case "workplace_pension_contribution_guidance":
      return composeWorkplacePensionContributionGuidance(capability, input);
    case "adviser_platform_model_portfolio_review":
      return composeAdviserModelPortfolioReview(capability, input);
    case "retirement_pension_task_orchestration":
      return composeRetirementPensionTaskOrchestration(capability, input);
  }
}

function evaluateCustomerScope(prompt: string, customerId: string) {
  const normalized = prompt.toUpperCase();
  const requestedCustomer = normalized.match(/\bUK\d{3}\b/)?.[0];
  if (!requestedCustomer || requestedCustomer === customerId.toUpperCase()) return null;

  return {
    status: "denied" as const,
    intent: "cross-customer data access",
    confidence: 0.99,
    reasoning: `The request references ${requestedCustomer}, but the active request context is scoped to ${customerId}.`,
    resolver: "rules" as const,
    policyDecision: {
      name: "customer_scope_entitlement",
      status: "requires_confirmation" as const,
      detail: "The gateway blocks cross-customer access unless the caller has an explicit entitlement for that customer."
    }
  };
}

function extractPercentage(prompt: string) {
  const match = prompt.match(/\b(\d{1,3}(?:\.\d+)?)\s*(?:%|percent|per cent)\b/i);
  if (!match) return undefined;

  const rate = Number(match[1]);
  return Number.isFinite(rate) ? rate : undefined;
}

function extractRetirementAge(prompt: string) {
  const patterns = [
    /\bretire(?:ment)?\s*(?:at|age)?\s*(\d{2,3})\b/i,
    /\bage\s*(\d{2,3})\s*(?:retire|retirement)\b/i,
    /\b(\d{2,3})\s*(?:year[-\s]?old|years old)\s*(?:retire|retirement)\b/i,
    /(\d{2,3})\s*岁\s*(?:退休|retire)/i,
    /(?:退休|retire)\s*(?:到|在|at)?\s*(\d{2,3})\s*岁?/i
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (!match) continue;
    const age = Number(match[1]);
    if (Number.isFinite(age)) return age;
  }

  return undefined;
}

function extractMoneyAfter(prompt: string, keywords: string[]) {
  const lower = prompt.toLowerCase();
  if (!keywords.some((keyword) => lower.includes(keyword))) return undefined;
  const matches = [...prompt.matchAll(
    /[£¥]\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?|(\d+(?:\.\d+)?)\s*(?:万|萬元|万元)|([一二两三四五六七八九十]+)\s*(?:万|萬元|万元)|\b(\d{4,7})\b/g
  )];
  const match = matches.at(-1);
  const chineseWan = match?.[3];
  if (chineseWan) {
    const value = parseSmallChineseNumber(chineseWan);
    return Number.isFinite(value) ? value * 10000 : undefined;
  }
  const raw = match?.[1] ?? match?.[2] ?? match?.[4];
  if (!raw) return undefined;
  const value = Number(raw.replaceAll(",", ""));
  if (match?.[2]) return Number.isFinite(value) ? value * 10000 : undefined;
  return Number.isFinite(value) ? value : undefined;
}

function parseSmallChineseNumber(value: string) {
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  };
  if (value === "十") return 10;
  if (value.includes("十")) {
    const [tensRaw, onesRaw] = value.split("十");
    const tens = tensRaw ? digits[tensRaw] ?? 0 : 1;
    const ones = onesRaw ? digits[onesRaw] ?? 0 : 0;
    return tens * 10 + ones;
  }
  return digits[value] ?? Number.NaN;
}

function extractDrawdownGoal(prompt: string) {
  const lower = prompt.toLowerCase();
  if (lower.includes("annuity")) return "buy_annuity" as const;
  if (lower.includes("cash out") || lower.includes("withdraw all")) return "cash_out" as const;
  if (lower.includes("income") || lower.includes("drawdown")) return "take_income_within_five_years" as const;
  if (lower.includes("keep invested") || lower.includes("stay invested")) return "keep_invested" as const;
  return undefined;
}

function extractRiskProfile(prompt: string) {
  const lower = prompt.toLowerCase();
  if (lower.includes("adventurous")) return "adventurous" as const;
  if (lower.includes("growth")) return "growth" as const;
  if (lower.includes("cautious")) return "cautious" as const;
  if (lower.includes("balanced")) return "balanced" as const;
  return undefined;
}

function extractPensionTaskIntent(prompt: string) {
  const lower = prompt.toLowerCase();
  if (/(?:公积金|住房公积金|缺钱|提取|取一部分|拿出来|还房贷|withdraw|cash access)/iu.test(lower)) {
    return "cash_access_exploration" as const;
  }
  if (/(?:准备退休|什么时候退休|怎样领取|领取养老金|退休最合适|claim|retirement planning)/iu.test(lower)) {
    return "retirement_claim_planning" as const;
  }
  if (/(?:比例|组成|构成|分布|配置|composition|allocation)/iu.test(lower)) {
    return "pot_composition" as const;
  }
  return undefined;
}

function extractIsaWorkflowId(prompt: string) {
  const lower = prompt.toLowerCase();
  if (lower.includes("cash drag") || lower.includes("uninvested cash") || lower.includes("cash allocation")) {
    return "isa_cash_drag_review" as const;
  }
  if (
    lower.includes("can i add") ||
    lower.includes("subscribe") ||
    lower.includes("subscription") ||
    lower.includes("planned isa")
  ) {
    return "isa_subscription_feasibility" as const;
  }
  if (
    lower.includes("allowance left") ||
    lower.includes("remaining allowance") ||
    lower.includes("left this tax year") ||
    lower.includes("how much of my isa allowance")
  ) {
    return "isa_allowance_remaining" as const;
  }
  if (lower.includes("full review") || lower.includes("overall review")) return "isa_full_review" as const;
  return undefined;
}

type FieldExtractor = (
  body: Record<string, unknown>,
  prompt: string,
  fieldName: string,
  extractor: InputExtractor
) => unknown;

const fieldExtractors: Record<InputExtractor["kind"], FieldExtractor> = {
  body: (body, _prompt, fieldName) => body[fieldName],
  isa_workflow: (_body, prompt) => extractIsaWorkflowId(prompt),
  money_after: (_body, prompt, _fieldName, extractor) =>
    extractor?.kind === "money_after" ? extractMoneyAfter(prompt, extractor.keywords) : undefined,
  drawdown_goal: (_body, prompt) => extractDrawdownGoal(prompt),
  pension_task_intent: (_body, prompt) => extractPensionTaskIntent(prompt),
  percentage: (_body, prompt) => extractPercentage(prompt),
  retirement_age: (_body, prompt) => extractRetirementAge(prompt),
  risk_profile: (_body, prompt) => extractRiskProfile(prompt)
};

const workflowCapabilities: Record<MicroWorkflowId, string> = {
  isa_subscription_feasibility: "personal_investing_isa_allowance_review",
  adviser_review_pack_generation: "adviser_platform_model_portfolio_review",
  retirement_goal_gap_projection: "workplace_pension_contribution_guidance",
  retirement_pension_task_orchestration: "retirement_pension_task_orchestration"
};

function resolveMicroWorkflowId(body: Record<string, unknown>, result: Record<string, unknown>) {
  const capabilityId = typeof result.capability === "string" ? result.capability : undefined;
  const requested = body.microWorkflowId;
  if (
    typeof requested === "string" &&
    microWorkflowIds.includes(requested as MicroWorkflowId) &&
    workflowCapabilities[requested as MicroWorkflowId] === capabilityId
  ) {
    return requested as MicroWorkflowId;
  }
  const resultWorkflowId = result.workflow_id;
  if (
    typeof resultWorkflowId === "string" &&
    microWorkflowIds.includes(resultWorkflowId as MicroWorkflowId) &&
    workflowCapabilities[resultWorkflowId as MicroWorkflowId] === capabilityId
  ) {
    return resultWorkflowId as MicroWorkflowId;
  }
  return undefined;
}

function buildCapabilityInput(
  capability: NonNullable<ReturnType<typeof getCapability>>,
  body: Record<string, unknown>,
  prompt: string
): Record<string, unknown> {
  const capabilityPackage = getCapabilityPackage(capability.id);
  if (capabilityPackage) {
    return buildCapabilityInputFromPackage(capabilityPackage.input, body, prompt);
  }

  const input: Record<string, unknown> = {};
  for (const field of Object.keys(capability.inputSchema)) {
    const value = body[field];
    if (value !== undefined && value !== null && value !== "") {
      input[field] = value;
    }
  }
  return input;
}

function buildCapabilityInputFromPackage(
  contract: Record<string, InputContractField>,
  body: Record<string, unknown>,
  prompt: string
) {
  const input: Record<string, unknown> = {};

  for (const [fieldName, field] of Object.entries(contract)) {
    const candidates = field.extractors
      .map((extractor) => {
        const extract = fieldExtractors[extractor.kind];
        const value = extract?.(body, prompt, fieldName, extractor);
        return normalizeExtractedValue(value, field);
      })
      .filter((value) => value !== undefined && value !== null && value !== "");

    const value = chooseInputValue(candidates, field);
    if (value !== undefined && value !== null && value !== "") {
      input[fieldName] = value;
    }
  }

  return input;
}

function chooseInputValue(candidates: unknown[], field: InputContractField) {
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  const [bodyValue, promptValue] = candidates;
  if (
    promptValue !== undefined &&
    field.defaultValue !== undefined &&
    bodyValue === field.defaultValue &&
    promptValue !== bodyValue
  ) {
    return promptValue;
  }

  return field.sourcePriority?.[0] === "prompt" ? promptValue : bodyValue;
}

function normalizeExtractedValue(value: unknown, field: InputContractField) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string" && ["number", "integer", "percentage"].includes(field.type)) {
    const parsed = Number(value.replaceAll(",", ""));
    return Number.isFinite(parsed) ? normalizeNumericValue(parsed, field) : value;
  }
  if (typeof value === "number") return normalizeNumericValue(value, field);
  return value;
}

function normalizeNumericValue(value: number, field: InputContractField) {
  if (!Number.isFinite(value)) return undefined;
  return field.type === "integer" ? Math.trunc(value) : value;
}

app.get("/audit/:traceId", (req, res) => {
  const record = getAuditRecord(req.params.traceId);
  if (!record) {
    res.status(404).json({ error: "Audit trace not found" });
    return;
  }
  res.json(record);
});

app.get("/workflow-runs/:runId", (req, res) => {
  const run = getWorkflowRun(req.params.runId);
  if (!run) {
    res.status(404).json({ error: "Workflow run not found" });
    return;
  }
  res.json(run);
});

app.post("/workflow-runs/:runId/actions", async (req, res, next) => {
  try {
    const parsed = workflowActionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid workflow action", issues: parsed.error.issues });
      return;
    }
    const result = applyWorkflowAction(req.params.runId, parsed.data);
    if ("error" in result) {
      res.status(result.status ?? 500).json(result);
      return;
    }
    let run = result.run;
    if (parsed.data.action === "retry" || parsed.data.payload) {
      const capability = getCapability(run.capabilityId);
      if (!capability) {
        res.status(500).json({ error: "Workflow capability was not found" });
        return;
      }
      const refreshedResult = await composeCapability(capability, run.input);
      run = updateWorkflowRunResult(run.id, refreshedResult) ?? run;
    }
    res.json(run);
  } catch (error) {
    next(error);
  }
});

app.get("/audit/:traceId/events", (req, res) => {
  const events = getAuditEvents(req.params.traceId);
  if (!events) {
    res.status(404).json({ error: "Audit trace not found" });
    return;
  }
  res.json({ traceId: req.params.traceId, events });
});

app.get("/requests/:requestId/audit", (req, res) => {
  const record = getAuditRecordByRequestId(req.params.requestId);
  if (!record) {
    res.status(404).json({ error: "Request audit record not found" });
    return;
  }
  res.json(record);
});

app.get("/mcp/sessions", (req, res) => {
  const limit = Number(req.query.limit ?? 20);
  res.json({
    sessions: listMcpSessions(Number.isFinite(limit) ? limit : 20)
  });
});

app.get("/mcp/sessions/:sessionId", (req, res) => {
  const session = getMcpSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: "MCP session not found" });
    return;
  }
  res.json(session);
});

app.post("/mcp/sessions/:sessionId/steps", (req, res) => {
  const result = recordMcpStep({
    sessionId: req.params.sessionId,
    clientName: typeof req.body?.clientName === "string" ? req.body.clientName : undefined,
    actor: req.body?.actor,
    kind: req.body?.kind,
    name: String(req.body?.name ?? "unknown"),
    status: req.body?.status,
    summary: String(req.body?.summary ?? ""),
    traceId: typeof req.body?.traceId === "string" ? req.body.traceId : undefined,
    capabilityId: req.body?.capabilityId,
    metadata: req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : undefined
  });
  res.json(result);
});

app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(500).json({
    error: "Gateway request failed",
    detail: error.message
  });
});

app.listen(port, () => {
  console.log(`Agent capability gateway listening on http://localhost:${port}`);
});
