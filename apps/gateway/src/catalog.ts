import type { CapabilityDefinition } from "@agent-bridge/shared";

export const capabilities: CapabilityDefinition[] = [
  {
    id: "retirement_readiness_assessment",
    name: "Retirement Readiness Assessment",
    description: "Assess whether a customer is on track for retirement at a target age.",
    businessOutcome: "A structured readiness assessment with risks, evidence, and next actions.",
    requiredApis: ["Profile API", "Accounts API", "Holdings API", "Projection API"],
    inputSchema: {
      customerId: "string",
      targetRetirementAge: "number optional"
    },
    policy: {
      dataAccess: "read",
      requiresCustomerConfirmation: false,
      auditRequired: true
    },
    examplePrompts: [
      "Can this client retire at age 60?",
      "Assess retirement readiness and explain the key risks."
    ]
  },
  {
    id: "contribution_optimization",
    name: "Contribution Optimization",
    description: "Recommend contribution changes within plan and tax constraints.",
    businessOutcome: "A contribution recommendation with projected impact and confirmation requirements.",
    requiredApis: [
      "Profile API",
      "Accounts API",
      "Contribution API",
      "Tax Limits API",
      "Projection API"
    ],
    inputSchema: {
      customerId: "string",
      desiredContributionRate: "number optional"
    },
    policy: {
      dataAccess: "recommendation",
      requiresCustomerConfirmation: true,
      auditRequired: true
    },
    examplePrompts: [
      "Should I increase my retirement contribution this year?",
      "What contribution change improves retirement outcome without exceeding limits?"
    ]
  }
];

export function getCapability(id: string) {
  return capabilities.find((capability) => capability.id === id);
}
