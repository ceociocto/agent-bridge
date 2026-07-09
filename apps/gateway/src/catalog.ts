import type { CapabilityDefinition } from "@agent-bridge/shared";

export const capabilities: CapabilityDefinition[] = [
  {
    id: "personal_investing_isa_allowance_review",
    name: "Personal Investing ISA Allowance Review",
    description:
      "Assess a UK retail investor's Stocks and Shares ISA usage, remaining allowance, cash drag, and next actions.",
    businessOutcome:
      "A tax-wrapper-aware ISA summary with remaining allowance, investment account context, and execution-safe next actions.",
    requiredApis: ["Profile API", "Accounts API", "ISA Subscription API", "Holdings API"],
    inputSchema: {
      customerId: "string",
      plannedIsaSubscription: "number optional"
    },
    routing: {
      domains: ["personal investing", "isa", "stocks and shares isa", "retail investment"],
      keywords: ["isa", "stocks and shares", "investment account", "tax wrapper", "cash drag", "allowance"],
      positiveExamples: [
        "How much of my ISA allowance do I have left this tax year?",
        "Can I add 8000 pounds to my Fidelity Stocks and Shares ISA?",
        "Review this client's ISA usage and cash drag.",
        "Check whether my planned ISA subscription fits the annual allowance."
      ],
      negativeExamples: [
        "Can I take income from my SIPP drawdown account?",
        "Should I raise my workplace pension contribution?",
        "Prepare an adviser model portfolio drift review."
      ],
      riskLevel: "medium"
    },
    policy: {
      dataAccess: "analysis",
      requiresCustomerConfirmation: false,
      auditRequired: true
    },
    examplePrompts: [
      "How much of my ISA allowance do I have left this tax year?",
      "Can I add £8,000 to my Fidelity Stocks and Shares ISA?",
      "Review this client's ISA usage and cash drag."
    ]
  },
  {
    id: "sipp_drawdown_pathway_review",
    name: "SIPP Drawdown Pathway Review",
    description:
      "Review a UK SIPP drawdown customer's pension access goal, pathway fit, withdrawal sustainability, and MPAA risk.",
    businessOutcome:
      "A drawdown pathway assessment with income sustainability, tax-wrapper constraints, and confirmation-gated next actions.",
    requiredApis: [
      "Profile API",
      "Accounts API",
      "Drawdown API",
      "Pension Allowance API",
      "Retirement Projection API"
    ],
    inputSchema: {
      customerId: "string",
      plannedDrawdownIncome: "number optional",
      drawdownGoal: "string optional"
    },
    routing: {
      domains: ["sipp", "retirement", "drawdown", "pension income"],
      keywords: ["sipp", "drawdown", "investment pathway", "pathways", "mpaa", "taxable pension", "take income"],
      positiveExamples: [
        "Can I take 18000 pounds a year from my SIPP drawdown account?",
        "Which investment pathway fits if I want income within five years?",
        "Review the MPAA risk before I draw taxable pension income.",
        "Is my planned pension drawdown income sustainable?"
      ],
      negativeExamples: [
        "How much ISA allowance do I have left?",
        "Am I missing employer match in my workplace pension?",
        "Create a model portfolio evidence pack for an adviser review."
      ],
      riskLevel: "high"
    },
    policy: {
      dataAccess: "recommendation",
      requiresCustomerConfirmation: true,
      auditRequired: true
    },
    examplePrompts: [
      "Can I take £18,000 a year from my SIPP drawdown account?",
      "Which investment pathway fits if I want income within five years?",
      "Review the MPAA risk before I draw taxable pension income."
    ]
  },
  {
    id: "workplace_pension_contribution_guidance",
    name: "Workplace Pension Contribution Guidance",
    description:
      "Help a UK workplace pension member understand contribution choices, employer matching, salary sacrifice, and annual allowance constraints.",
    businessOutcome:
      "A workplace savings recommendation with employer-match evidence, projected retirement impact, and confirmation controls.",
    requiredApis: [
      "Profile API",
      "Workplace Plan API",
      "Contribution API",
      "Pension Allowance API",
      "Retirement Projection API"
    ],
    inputSchema: {
      customerId: "string",
      desiredContributionRate: "number optional",
      targetRetirementAge: "number optional"
    },
    routing: {
      domains: ["workplace investing", "workplace pension", "contributions", "employer benefits"],
      keywords: ["workplace", "employer match", "salary sacrifice", "pension contribution", "contribution rate"],
      positiveExamples: [
        "Should I raise my workplace pension contribution to 10 percent?",
        "Am I missing any employer match in my workplace pension?",
        "Show the retirement impact of increasing contributions through salary sacrifice.",
        "Help me understand my workplace pension contribution choices."
      ],
      negativeExamples: [
        "Can I subscribe more money into my ISA?",
        "Can I withdraw taxable pension income from my SIPP?",
        "Does this advised client still match the balanced model portfolio?"
      ],
      riskLevel: "high"
    },
    policy: {
      dataAccess: "recommendation",
      requiresCustomerConfirmation: true,
      auditRequired: true
    },
    examplePrompts: [
      "Should I raise my workplace pension contribution to 10%?",
      "Am I missing any employer match in my workplace pension?",
      "Show the retirement impact of increasing contributions through salary sacrifice."
    ]
  },
  {
    id: "adviser_platform_model_portfolio_review",
    name: "Adviser Platform Model Portfolio Review",
    description:
      "Support an adviser reviewing a client's model portfolio on an adviser platform with suitability, drift, and platform evidence.",
    businessOutcome:
      "An adviser-facing portfolio review pack with model drift, risk alignment, evidence, and compliance-safe next actions.",
    requiredApis: [
      "Adviser Entitlement API",
      "Client Profile API",
      "Platform Accounts API",
      "Model Portfolio API",
      "Holdings API"
    ],
    inputSchema: {
      customerId: "string",
      adviserFirmId: "string optional",
      riskProfile: "string optional"
    },
    routing: {
      domains: ["adviser solutions", "adviser platform", "model portfolio", "suitability review"],
      keywords: ["adviser", "advisor", "model portfolio", "suitability", "drift", "review pack", "wealthbuilder"],
      positiveExamples: [
        "Prepare a model portfolio drift review for this advised client.",
        "Does this client still match the balanced model portfolio?",
        "Create an adviser platform evidence pack for the next review meeting.",
        "Check suitability and drift for a client on the adviser platform."
      ],
      negativeExamples: [
        "How much ISA allowance does this retail investor have left?",
        "Should this workplace pension member raise contributions?",
        "Can this SIPP customer take drawdown income?"
      ],
      riskLevel: "medium"
    },
    policy: {
      dataAccess: "analysis",
      requiresCustomerConfirmation: false,
      auditRequired: true
    },
    examplePrompts: [
      "Prepare a model portfolio drift review for this advised client.",
      "Does this client still match the balanced model portfolio?",
      "Create an adviser platform evidence pack for the next review meeting."
    ]
  }
];

export function getCapability(id: string) {
  return capabilities.find((capability) => capability.id === id);
}
