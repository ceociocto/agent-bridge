import { loadLocalEnv } from "./env.js";
import cors from "cors";
import express from "express";
import { capabilityInvokeSchema } from "@agent-bridge/shared";
import { getAuditEvents, getAuditRecord, getAuditRecordByRequestId } from "./audit.js";
import { capabilities, getCapability } from "./catalog.js";
import {
  composeAdviserModelPortfolioReview,
  composeIsaAllowanceReview,
  composeSippDrawdownPathwayReview,
  composeWorkplacePensionContributionGuidance
} from "./composers.js";
import { resolveIntent } from "./intent.js";
import { isLlmIntentResolverConfigured } from "./llmIntentResolver.js";
import { getMcpSession, listMcpSessions, recordMcpStep } from "./mcpSessions.js";

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
    capabilities
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
  const match = prompt.match(/\b(\d{1,2}(?:\.\d+)?)\s*%/);
  if (!match) return undefined;

  const rate = Number(match[1]);
  return Number.isFinite(rate) ? rate : undefined;
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

type FieldExtractor = (body: Record<string, unknown>, prompt: string) => unknown;

// Only fields declared in the resolved capability's inputSchema are populated.
// This prevents a money figure intended for one product (e.g. a drawdown income)
// from being extracted and reinterpreted as a param for a different capability
// (e.g. plannedIsaSubscription) when the prompt mentions multiple products.
const fieldExtractors: Record<string, FieldExtractor> = {
  customerId: (body) => body.customerId,
  plannedIsaSubscription: (body, prompt) =>
    body.plannedIsaSubscription ?? extractMoneyAfter(prompt, ["isa", "subscribe", "add"]),
  plannedDrawdownIncome: (body, prompt) =>
    body.plannedDrawdownIncome ?? extractMoneyAfter(prompt, ["drawdown", "income", "take"]),
  drawdownGoal: (body, prompt) => body.drawdownGoal ?? extractDrawdownGoal(prompt),
  desiredContributionRate: (body, prompt) =>
    body.desiredContributionRate ?? extractPercentage(prompt),
  targetRetirementAge: (body) => body.targetRetirementAge,
  adviserFirmId: (body) => body.adviserFirmId,
  riskProfile: (body, prompt) => body.riskProfile ?? extractRiskProfile(prompt)
};

function buildCapabilityInput(
  capability: NonNullable<ReturnType<typeof getCapability>>,
  body: Record<string, unknown>,
  prompt: string
): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const field of Object.keys(capability.inputSchema)) {
    const extract = fieldExtractors[field];
    if (!extract) continue;
    const value = extract(body, prompt);
    if (value !== undefined && value !== null && value !== "") {
      input[field] = value;
    }
  }
  return input;
}

app.get("/audit/:traceId", (req, res) => {
  const record = getAuditRecord(req.params.traceId);
  if (!record) {
    res.status(404).json({ error: "Audit trace not found" });
    return;
  }
  res.json(record);
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
