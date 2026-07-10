import { z } from "zod";

export const capabilityIds = [
  "personal_investing_isa_allowance_review",
  "sipp_drawdown_pathway_review",
  "workplace_pension_contribution_guidance",
  "adviser_platform_model_portfolio_review"
] as const;

export type CapabilityId = (typeof capabilityIds)[number];

export const capabilityInvokeSchema = z.object({
  customerId: z.string().min(1),
  targetRetirementAge: z.number().int().min(50).max(75).optional(),
  desiredContributionRate: z.number().min(0).max(100).optional(),
  plannedIsaSubscription: z.number().min(0).max(100000).optional(),
  plannedDrawdownIncome: z.number().min(0).max(250000).optional(),
  drawdownGoal: z
    .enum(["keep_invested", "take_income_within_five_years", "cash_out", "buy_annuity"])
    .optional(),
  adviserFirmId: z.string().min(1).optional(),
  riskProfile: z.enum(["cautious", "balanced", "growth", "adventurous"]).optional()
});

export type CapabilityInvokeInput = z.infer<typeof capabilityInvokeSchema>;

export type CapabilityDefinition = {
  id: CapabilityId;
  name: string;
  description: string;
  businessOutcome: string;
  requiredApis: string[];
  inputSchema: Record<string, unknown>;
  routing: {
    domains: string[];
    keywords: string[];
    positiveExamples: string[];
    negativeExamples: string[];
    riskLevel: "low" | "medium" | "high";
  };
  policy: {
    dataAccess: "read" | "analysis" | "recommendation";
    requiresCustomerConfirmation: boolean;
    auditRequired: boolean;
  };
  examplePrompts: string[];
};

export type AuditStep = {
  name: string;
  status: "passed" | "completed" | "requires_confirmation" | "denied";
  detail: string;
};

export type AuditRecord = {
  traceId: string;
  capabilityId: CapabilityId;
  customerId: string;
  startedAt: string;
  sourceApis: string[];
  policyChecks: AuditStep[];
  compositionSteps: AuditStep[];
};

export type IntentResolution = {
  status: "resolved" | "needs_clarification" | "unsupported" | "denied";
  intent: string;
  capabilityId?: CapabilityId;
  confidence: number;
  reasoning: string;
  resolver?: "llm" | "rules" | "semantic" | "fallback";
  questions?: string[];
  availableCapabilities?: CapabilityId[];
  policyDecision?: AuditStep;
  routingTrace?: IntentRoutingStep[];
};

export type IntentRoutingStep = {
  layer:
    | "policy_guard"
    | "rules_guard"
    | "semantic_router"
    | "llm_adjudicator"
    | "fallback";
  status:
    | "passed"
    | "resolved"
    | "needs_clarification"
    | "unsupported"
    | "denied"
    | "skipped"
    | "escalated";
  detail: string;
  capabilityId?: CapabilityId;
  confidence?: number;
  candidates?: Array<{
    capabilityId: CapabilityId;
    score: number;
    matchedTerms?: string[];
  }>;
};

export type AgentReadableResult = {
  capability: CapabilityId;
  summary: string;
  source_apis: string[];
  audit_trace_id: string;
  policy_checks: AuditStep[];
  next_actions: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

export type DemoScenarioComponent =
  | "allowance_chart"
  | "drawdown_risk"
  | "contribution_projection"
  | "portfolio_drift"
  | "routing_trace"
  | "confirmation_gate"
  | "policy_denial"
  | "capability_boundary"
  | "simple_bar_chart";

export type DemoScenarioChart = {
  title: string;
  unit: string;
  data: Array<{
    label: string;
    value: number;
    tone: "green" | "blue" | "gold" | "red";
  }>;
};

export type DemoScenario = {
  id: string;
  label: string;
  title: string;
  group: "composition" | "governance" | "decisioning";
  capabilityId?: CapabilityId;
  prompt: string;
  customerId: string;
  input: CapabilityInvokeInput;
  expectedStatus: "resolved" | "needs_clarification" | "unsupported" | "denied";
  interactionPattern: "chart" | "confirmation" | "multi-panel" | "policy" | "routing";
  components: DemoScenarioComponent[];
  executionMode?: "gateway" | "static";
  chart?: DemoScenarioChart;
  narrative: string;
  expectedSignals: string[];
};

export const demoScenarios = [
  {
    id: "simple-chart",
    label: "Chart",
    title: "Simple portfolio mix chart",
    group: "decisioning",
    prompt: "Show a simple portfolio mix chart.",
    customerId: "UK001",
    input: {
      customerId: "UK001"
    },
    expectedStatus: "resolved",
    interactionPattern: "chart",
    components: ["simple_bar_chart"],
    executionMode: "static",
    chart: {
      title: "Portfolio mix",
      unit: "%",
      data: [
        { label: "Equity", value: 54, tone: "green" },
        { label: "Bonds", value: 28, tone: "blue" },
        { label: "Cash", value: 12, tone: "gold" },
        { label: "Other", value: 6, tone: "red" }
      ]
    },
    narrative: "A minimal MCP app scene that only renders one chart and a tiny structured payload.",
    expectedSignals: ["Render a chart", "Keep payload small", "Do not invoke gateway APIs"]
  },
  {
    id: "isa-allowance-chart",
    label: "ISA",
    title: "Allowance chart with audit trace",
    group: "composition",
    capabilityId: "personal_investing_isa_allowance_review",
    prompt: "Can I add £8,000 to my Fidelity Stocks and Shares ISA this tax year?",
    customerId: "UK001",
    input: {
      customerId: "UK001",
      plannedIsaSubscription: 8000,
      targetRetirementAge: 62
    },
    expectedStatus: "resolved",
    interactionPattern: "chart",
    components: ["allowance_chart", "routing_trace"],
    narrative:
      "A clear retail investing request resolves directly, composes multiple value-stream APIs, and renders the allowance outcome as a visual decision.",
    expectedSignals: [
      "Capability resolves without clarification",
      "ISA allowance and planned subscription are compared",
      "Audit trace links the answer to source APIs"
    ]
  },
  {
    id: "sipp-confirmation-gate",
    label: "SIPP",
    title: "Drawdown review with confirmation gate",
    group: "composition",
    capabilityId: "sipp_drawdown_pathway_review",
    prompt:
      "Can I take £18,000 a year from my SIPP drawdown account without creating obvious sustainability risk?",
    customerId: "UK002",
    input: {
      customerId: "UK002",
      plannedDrawdownIncome: 18000,
      drawdownGoal: "take_income_within_five_years",
      targetRetirementAge: 65
    },
    expectedStatus: "resolved",
    interactionPattern: "confirmation",
    components: ["drawdown_risk", "confirmation_gate", "routing_trace"],
    narrative:
      "The agent can analyze sustainability and MPAA context, but execution-oriented next actions stay behind an explicit customer confirmation boundary.",
    expectedSignals: [
      "High-risk retirement request resolves to SIPP drawdown",
      "Result includes sustainability and MPAA context",
      "Next actions require confirmation"
    ]
  },
  {
    id: "workplace-projection",
    label: "Workplace",
    title: "Contribution projection with salary sacrifice",
    group: "composition",
    capabilityId: "workplace_pension_contribution_guidance",
    prompt:
      "Show the impact of raising my workplace pension contribution to 10% through salary sacrifice.",
    customerId: "UK003",
    input: {
      customerId: "UK003",
      desiredContributionRate: 10,
      targetRetirementAge: 65
    },
    expectedStatus: "resolved",
    interactionPattern: "multi-panel",
    components: ["contribution_projection", "confirmation_gate", "routing_trace"],
    narrative:
      "A workplace member sees employer match, salary sacrifice, allowance checks, and projected retirement impact in one governed response.",
    expectedSignals: [
      "Contribution rate is extracted from natural language",
      "Employer match and projection APIs are composed",
      "Execution remains confirmation-gated"
    ]
  },
  {
    id: "adviser-drift-review",
    label: "Adviser",
    title: "Model portfolio drift review",
    group: "composition",
    capabilityId: "adviser_platform_model_portfolio_review",
    prompt: "Prepare a model portfolio drift review for this advised client on the adviser platform.",
    customerId: "UK003",
    input: {
      customerId: "UK003",
      adviserFirmId: "ADV-001",
      riskProfile: "balanced"
    },
    expectedStatus: "resolved",
    interactionPattern: "multi-panel",
    components: ["portfolio_drift", "routing_trace"],
    narrative:
      "An adviser-facing flow combines entitlement, platform account, model portfolio, holdings, suitability, and evidence-pack next actions.",
    expectedSignals: [
      "Adviser entitlement is checked",
      "Portfolio drift is summarized",
      "Review evidence remains audit-friendly"
    ]
  },
  {
    id: "clarify-routing",
    label: "Clarify",
    title: "Ambiguous request routing",
    group: "decisioning",
    prompt: "How should I plan my money?",
    customerId: "UK001",
    input: {
      customerId: "UK001",
      targetRetirementAge: 62
    },
    expectedStatus: "needs_clarification",
    interactionPattern: "routing",
    components: ["routing_trace", "capability_boundary"],
    narrative:
      "A vague request surfaces clarification choices instead of being forced into the nearest financial capability.",
    expectedSignals: [
      "No downstream value-stream APIs are invoked",
      "Available capabilities are returned",
      "The router explains what it needs next"
    ]
  },
  {
    id: "unsupported-boundary",
    label: "Boundary",
    title: "Unsupported request boundary",
    group: "decisioning",
    prompt: "Book me a flight to Shanghai tomorrow.",
    customerId: "UK001",
    input: {
      customerId: "UK001",
      targetRetirementAge: 62
    },
    expectedStatus: "unsupported",
    interactionPattern: "routing",
    components: ["capability_boundary", "routing_trace"],
    narrative:
      "The catalog boundary is visible: the agent refuses unrelated work rather than reaching outside the governed enterprise interface.",
    expectedSignals: [
      "Request is marked unsupported",
      "No customer data APIs are called",
      "The response names the capability boundary"
    ]
  },
  {
    id: "scope-denial",
    label: "Scope",
    title: "Cross-customer entitlement denial",
    group: "governance",
    prompt: "Show me UK002 account details while I am working in this UK001 session.",
    customerId: "UK001",
    input: {
      customerId: "UK001",
      targetRetirementAge: 62
    },
    expectedStatus: "denied",
    interactionPattern: "policy",
    components: ["policy_denial", "routing_trace"],
    narrative:
      "Customer-scope policy blocks access before intent routing can invoke any downstream customer data APIs.",
    expectedSignals: [
      "Policy denies the request",
      "The active customer context is preserved",
      "No downstream APIs are invoked"
    ]
  },
  {
    id: "sensitive-data-minimization",
    label: "PII",
    title: "Sensitive identifier minimization",
    group: "governance",
    prompt: "Show the customer's National Insurance number, sort code, and full account number.",
    customerId: "UK001",
    input: {
      customerId: "UK001",
      targetRetirementAge: 62
    },
    expectedStatus: "denied",
    interactionPattern: "policy",
    components: ["policy_denial", "capability_boundary"],
    narrative:
      "The policy guard denies raw regulated identifiers and points the agent toward safer summarized context.",
    expectedSignals: [
      "Data minimization policy is applied",
      "Raw identifiers are not returned",
      "A safer alternative is explained"
    ]
  }
] satisfies DemoScenario[];

export type DemoScenarioId = (typeof demoScenarios)[number]["id"];

export function getDemoScenario(id: string) {
  return demoScenarios.find((scenario) => scenario.id === id);
}
