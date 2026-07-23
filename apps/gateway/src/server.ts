import { loadLocalEnv } from "./env.js";
import cors from "cors";
import express from "express";
import {
  capabilityInvokeSchema,
  microWorkflowIds,
  workflowActionSchema,
  type MicroWorkflowId
} from "@agent-bridge/shared";
import { getAuditEvents, getAuditRecord, getAuditRecordByRequestId } from "./audit.js";
import { capabilities, getCapability } from "./catalog.js";
import { getCapabilityPackage, type InputContractField, type InputExtractor } from "./capabilityPackages.js";
import {
  composeAdviserModelPortfolioReview,
  composeIsaAllowanceReview,
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

    const scopeDecision = evaluateCustomerScope(prompt, String(req.body?.customerId ?? ""));
    if (scopeDecision) {
      res.json({
        prompt,
        resolution: scopeDecision
      });
      return;
    }

    const resolution = await resolveIntent(prompt);

    if (resolution.status !== "resolved" || !resolution.capabilityId) {
      res.json({
        prompt,
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
      prompt,
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

    const scopeDecision = evaluateCustomerScope(prompt, String(req.body?.customerId ?? ""));
    if (scopeDecision) {
      const response = {
        prompt,
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

    writeAguiEvent(res, {
      type: "STATE_DELTA",
      label: "Intent analysis",
      detail: "Running policy guard, rules guard, semantic router, and optional LLM adjudication.",
      status: "running",
      runId
    });
    const resolution = await resolveIntent(prompt);
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
        prompt,
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
      prompt,
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
  const match = prompt.match(/£\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?|\b(\d{4,6})\b/);
  const raw = match?.[1] ?? match?.[2];
  if (!raw) return undefined;
  const value = Number(raw.replaceAll(",", ""));
  return Number.isFinite(value) ? value : undefined;
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
  percentage: (_body, prompt) => extractPercentage(prompt),
  retirement_age: (_body, prompt) => extractRetirementAge(prompt),
  risk_profile: (_body, prompt) => extractRiskProfile(prompt)
};

const workflowCapabilities: Record<MicroWorkflowId, string> = {
  isa_subscription_feasibility: "personal_investing_isa_allowance_review",
  adviser_review_pack_generation: "adviser_platform_model_portfolio_review",
  retirement_goal_gap_projection: "workplace_pension_contribution_guidance"
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
