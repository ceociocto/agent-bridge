import type { AuditStep, CapabilityDefinition } from "@agent-bridge/shared";

export type PolicyDecisionContext = {
  channel?: string;
  customerId?: string;
  adviserFirmId?: string;
};

export type PolicyDecisionProvider = {
  evaluateCapabilityInvocation(
    capability: CapabilityDefinition,
    context?: PolicyDecisionContext
  ): Promise<AuditStep[]> | AuditStep[];
};

export class LocalPolicyDecisionProvider implements PolicyDecisionProvider {
  evaluateCapabilityInvocation(capability: CapabilityDefinition): AuditStep[] {
    const checks: AuditStep[] = [
      {
        name: "customer_data_access",
        status: "passed",
        detail: `${capability.policy.dataAccess} access is allowed for this POC customer context.`
      },
      {
        name: "audit_required",
        status: "passed",
        detail: capability.policy.auditRequired
          ? "Audit trace will be generated for the capability invocation."
          : "Audit trace is not required for this capability."
      }
    ];

    if (capability.policy.requiresCustomerConfirmation) {
      checks.push({
        name: "customer_confirmation",
        status: "requires_confirmation",
        detail: "The gateway may recommend a next action, but execution requires explicit customer confirmation."
      });
    }

    return checks;
  }
}

export class OpaPolicyDecisionProvider implements PolicyDecisionProvider {
  constructor(
    private readonly policyUrl: string,
    private readonly fallback: PolicyDecisionProvider = new LocalPolicyDecisionProvider()
  ) {}

  async evaluateCapabilityInvocation(
    capability: CapabilityDefinition,
    context: PolicyDecisionContext = {}
  ): Promise<AuditStep[]> {
    const fallbackChecks = await this.fallback.evaluateCapabilityInvocation(capability, context);

    try {
      const response = await fetch(this.policyUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: {
            capability: {
              id: capability.id,
              policy: capability.policy,
              routing: capability.routing
            },
            context
          }
        })
      });

      if (!response.ok) {
        throw new Error(`OPA policy endpoint returned ${response.status}`);
      }

      const payload = (await response.json()) as { result?: { checks?: AuditStep[] } };
      return payload.result?.checks?.length ? payload.result.checks : fallbackChecks;
    } catch (error) {
      return [
        ...fallbackChecks,
        {
          name: "opa_policy_dry_run",
          status: "passed",
          detail: `OPA policy endpoint unavailable; local policy fallback used. ${
            error instanceof Error ? error.message : String(error)
          }`
        }
      ];
    }
  }
}

const localPolicyDecisionProvider = new LocalPolicyDecisionProvider();

export function createPolicyDecisionProvider(): PolicyDecisionProvider {
  const policyUrl = process.env.OPA_POLICY_URL;
  if (!policyUrl) return localPolicyDecisionProvider;
  return new OpaPolicyDecisionProvider(policyUrl, localPolicyDecisionProvider);
}

export async function evaluatePolicyWithProvider(
  capability: CapabilityDefinition,
  context?: PolicyDecisionContext,
  provider: PolicyDecisionProvider = createPolicyDecisionProvider()
): Promise<AuditStep[]> {
  return provider.evaluateCapabilityInvocation(capability, context);
}

export function evaluatePolicy(capability: CapabilityDefinition): AuditStep[] {
  return localPolicyDecisionProvider.evaluateCapabilityInvocation(capability);
}
