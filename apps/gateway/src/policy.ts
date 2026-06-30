import type { AuditStep, CapabilityDefinition } from "@agent-bridge/shared";

export function evaluatePolicy(capability: CapabilityDefinition): AuditStep[] {
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
