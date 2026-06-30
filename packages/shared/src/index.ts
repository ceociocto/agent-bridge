import { z } from "zod";

export const capabilityIds = [
  "retirement_readiness_assessment",
  "contribution_optimization"
] as const;

export type CapabilityId = (typeof capabilityIds)[number];

export const capabilityInvokeSchema = z.object({
  customerId: z.string().min(1),
  targetRetirementAge: z.number().int().min(50).max(75).optional(),
  desiredContributionRate: z.number().min(0).max(100).optional()
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
    dataAccess: "read" | "recommendation";
    requiresCustomerConfirmation: boolean;
    auditRequired: boolean;
  };
  examplePrompts: string[];
};

export type AuditStep = {
  name: string;
  status: "passed" | "completed" | "requires_confirmation";
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
  intent: string;
  capabilityId: CapabilityId;
  confidence: number;
  reasoning: string;
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
