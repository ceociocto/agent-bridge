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
