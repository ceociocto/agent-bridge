import type { CapabilityId, MicroWorkflowId } from "@agent-bridge/shared";

export type InputSource = "body" | "prompt";

export type InputExtractor =
  | { kind: "body" }
  | { kind: "percentage" }
  | { kind: "money_after"; keywords: string[] }
  | { kind: "retirement_age" }
  | { kind: "isa_workflow" }
  | { kind: "drawdown_goal" }
  | { kind: "pension_task_intent" }
  | { kind: "risk_profile" };

export type InputContractField = {
  type: "string" | "number" | "integer" | "percentage" | "enum";
  required?: boolean;
  defaultValue?: string | number;
  defaultFrom?: string;
  extractors: InputExtractor[];
  validation?: {
    min?: number;
    max?: number;
    allowedValues?: string[];
    outOfRange?: "reject" | "clarify";
  };
  sourcePriority?: InputSource[];
  mutable?: boolean;
  ui?: {
    control: "input" | "slider" | "stepper" | "select";
    min?: number;
    max?: number;
    step?: number;
  };
};

export type CapabilityPackage = {
  id: CapabilityId;
  version: string;
  intent: {
    examples: string[];
    keywords: string[];
    negativeExamples: string[];
  };
  input: Record<string, InputContractField>;
  policies: Array<{
    id: string;
    when: string;
    effect: "allow" | "deny" | "clarify" | "confirmation_required";
  }>;
  workflows: Array<{
    id: MicroWorkflowId;
    mutableFields: string[];
    steps: Array<{ id: string; when?: string; uiHint?: string }>;
  }>;
  apiBindings: Array<{
    id: string;
    source: string;
    params: Record<string, string>;
    provides: string[];
  }>;
};

export const capabilityPackages: CapabilityPackage[] = [
  {
    id: "personal_investing_isa_allowance_review",
    version: "2026.07.1",
    intent: {
      examples: [
        "How much of my ISA allowance do I have left this tax year?",
        "Can I add 8000 pounds to my Fidelity Stocks and Shares ISA?"
      ],
      keywords: ["isa", "stocks and shares", "allowance", "cash drag"],
      negativeExamples: ["Can I take income from my SIPP?", "Should I raise my workplace pension contribution?"]
    },
    input: {
      customerId: {
        type: "string",
        required: true,
        extractors: [{ kind: "body" }]
      },
      plannedIsaSubscription: {
        type: "number",
        extractors: [{ kind: "body" }, { kind: "money_after", keywords: ["isa", "subscribe", "add"] }],
        validation: { min: 0, max: 100000, outOfRange: "reject" },
        mutable: true,
        ui: { control: "slider", min: 0, max: 20000, step: 500 }
      },
      isaWorkflowId: {
        type: "enum",
        extractors: [{ kind: "body" }, { kind: "isa_workflow" }],
        validation: {
          allowedValues: [
            "isa_allowance_remaining",
            "isa_subscription_feasibility",
            "isa_cash_drag_review",
            "isa_full_review"
          ],
          outOfRange: "reject"
        }
      },
      microWorkflowId: {
        type: "enum",
        extractors: [{ kind: "body" }],
        validation: { allowedValues: ["isa_subscription_feasibility"], outOfRange: "reject" }
      }
    },
    policies: [
      {
        id: "isa_subscription_limit",
        when: "input.plannedIsaSubscription <= 100000",
        effect: "allow"
      }
    ],
    workflows: [
      {
        id: "isa_subscription_feasibility",
        mutableFields: ["plannedIsaSubscription"],
        steps: [
          { id: "review_allowance", uiHint: "allowance_report" },
          { id: "choose_amount", uiHint: "top_up_slider" },
          { id: "confirm_top_up", uiHint: "confirmation_gate" }
        ]
      }
    ],
    apiBindings: [
      {
        id: "isa_subscription",
        source: "valueStream.isaSubscription",
        params: { customerId: "$input.customerId" },
        provides: ["annualIsaAllowance", "stocksAndSharesIsaSubscribed", "cashIsaSubscribed"]
      }
    ]
  },
  {
    id: "sipp_drawdown_pathway_review",
    version: "2026.07.1",
    intent: {
      examples: ["Can I take 18000 pounds a year from my SIPP drawdown account?"],
      keywords: ["sipp", "drawdown", "investment pathway", "mpaa"],
      negativeExamples: ["How much ISA allowance do I have left?", "Am I missing employer match?"]
    },
    input: {
      customerId: {
        type: "string",
        required: true,
        extractors: [{ kind: "body" }]
      },
      plannedDrawdownIncome: {
        type: "number",
        extractors: [{ kind: "body" }, { kind: "money_after", keywords: ["drawdown", "income", "take"] }],
        validation: { min: 0, max: 250000, outOfRange: "reject" }
      },
      drawdownGoal: {
        type: "enum",
        extractors: [{ kind: "body" }, { kind: "drawdown_goal" }],
        validation: {
          allowedValues: ["keep_invested", "take_income_within_five_years", "cash_out", "buy_annuity"],
          outOfRange: "reject"
        }
      }
    },
    policies: [
      {
        id: "drawdown_execution_confirmation",
        when: "input.plannedDrawdownIncome changes currentAnnualIncome",
        effect: "confirmation_required"
      }
    ],
    workflows: [],
    apiBindings: [
      {
        id: "drawdown",
        source: "valueStream.drawdown",
        params: { customerId: "$input.customerId" },
        provides: ["pensionPot", "currentAnnualIncome", "selectedPathwayGoal"]
      }
    ]
  },
  {
    id: "workplace_pension_contribution_guidance",
    version: "2026.07.1",
    intent: {
      examples: [
        "Should I raise my workplace pension contribution to 10 percent?",
        "Am I on track to retire at 65?"
      ],
      keywords: ["workplace", "employer match", "salary sacrifice", "pension contribution", "retire"],
      negativeExamples: ["Can I subscribe more money into my ISA?", "Can I withdraw from my SIPP?"]
    },
    input: {
      customerId: {
        type: "string",
        required: true,
        extractors: [{ kind: "body" }]
      },
      desiredContributionRate: {
        type: "percentage",
        extractors: [{ kind: "body" }, { kind: "percentage" }],
        validation: { min: 0, max: 100, outOfRange: "reject" },
        mutable: true,
        ui: { control: "slider", min: 0, max: 40, step: 1 }
      },
      targetRetirementAge: {
        type: "integer",
        defaultValue: 65,
        defaultFrom: "profile.retirementGoalAge",
        extractors: [{ kind: "body" }, { kind: "retirement_age" }],
        validation: { min: 50, max: 75, outOfRange: "clarify" },
        sourcePriority: ["body", "prompt"],
        mutable: true,
        ui: { control: "stepper", min: 50, max: 75, step: 1 }
      },
      microWorkflowId: {
        type: "enum",
        extractors: [{ kind: "body" }],
        validation: { allowedValues: ["retirement_goal_gap_projection"], outOfRange: "reject" }
      }
    },
    policies: [
      {
        id: "retirement_age_bounds",
        when: "50 <= input.targetRetirementAge <= 75",
        effect: "clarify"
      },
      {
        id: "contribution_change_confirmation",
        when: "input.desiredContributionRate changes currentContributionRate",
        effect: "confirmation_required"
      }
    ],
    workflows: [
      {
        id: "retirement_goal_gap_projection",
        mutableFields: ["targetRetirementAge", "desiredContributionRate"],
        steps: [
          { id: "collect_assumptions", uiHint: "assumption_form" },
          { id: "explore_gap_options", when: "result.goalProbability < 75", uiHint: "gap_options" },
          { id: "run_projection", uiHint: "durable_projection" }
        ]
      }
    ],
    apiBindings: [
      {
        id: "projection",
        source: "valueStream.projection",
        params: {
          customerId: "$input.customerId",
          targetRetirementAge: "$input.targetRetirementAge",
          contributionRate: "$input.desiredContributionRate"
        },
        provides: ["projectedBalance", "goalProbability", "incomeReplacementRatio"]
      }
    ]
  },
  {
    id: "adviser_platform_model_portfolio_review",
    version: "2026.07.1",
    intent: {
      examples: ["Prepare a model portfolio drift review for this advised client."],
      keywords: ["adviser", "advisor", "model portfolio", "suitability", "drift"],
      negativeExamples: ["How much ISA allowance does this investor have left?", "Should this member raise contributions?"]
    },
    input: {
      customerId: {
        type: "string",
        required: true,
        extractors: [{ kind: "body" }]
      },
      adviserFirmId: {
        type: "string",
        extractors: [{ kind: "body" }]
      },
      riskProfile: {
        type: "enum",
        extractors: [{ kind: "body" }, { kind: "risk_profile" }],
        validation: { allowedValues: ["cautious", "balanced", "growth", "adventurous"], outOfRange: "reject" }
      },
      microWorkflowId: {
        type: "enum",
        extractors: [{ kind: "body" }],
        validation: { allowedValues: ["adviser_review_pack_generation"], outOfRange: "reject" }
      }
    },
    policies: [
      {
        id: "adviser_firm_entitlement",
        when: "input.adviserFirmId matches customer.adviserFirmId",
        effect: "allow"
      }
    ],
    workflows: [
      {
        id: "adviser_review_pack_generation",
        mutableFields: [],
        steps: [
          { id: "prepare_pack", uiHint: "review_pack" },
          { id: "resolve_exception", when: "result.portfolio_review.drift_score > 5", uiHint: "retry" },
          { id: "sign_off", uiHint: "confirmation_gate" }
        ]
      }
    ],
    apiBindings: [
      {
        id: "adviser_portfolio",
        source: "valueStream.adviserPortfolio",
        params: { customerId: "$input.customerId" },
        provides: ["modelName", "targetRiskProfile", "driftScore"]
      }
    ]
  },
  {
    id: "retirement_pension_task_orchestration",
    version: "2026.07.1",
    intent: {
      examples: [
        "我最近缺钱，想看看能不能从养老金里取一部分。",
        "我准备退休，想知道什么时候退休最合适，以及应该怎样领取养老金。"
      ],
      keywords: ["养老金", "提取", "缺钱", "退休", "领取", "比例", "账户构成"],
      negativeExamples: ["Can I add money to my ISA?", "Prepare an adviser review pack."]
    },
    input: {
      customerId: {
        type: "string",
        required: true,
        extractors: [{ kind: "body" }]
      },
      pensionTaskIntent: {
        type: "enum",
        extractors: [{ kind: "body" }, { kind: "pension_task_intent" }],
        validation: {
          allowedValues: ["cash_access_exploration", "retirement_claim_planning", "pot_composition"],
          outOfRange: "reject"
        }
      },
      requestedWithdrawalAmount: {
        type: "number",
        extractors: [{ kind: "body" }, { kind: "money_after", keywords: ["提取", "取", "拿", "withdraw"] }],
        validation: { min: 0, max: 1000000, outOfRange: "reject" },
        sourcePriority: ["prompt", "body"],
        mutable: true,
        ui: { control: "slider", min: 0, max: 200000, step: 5000 }
      },
      targetRetirementAge: {
        type: "integer",
        defaultValue: 63,
        extractors: [{ kind: "body" }, { kind: "retirement_age" }],
        validation: { min: 50, max: 75, outOfRange: "clarify" },
        mutable: true,
        ui: { control: "stepper", min: 50, max: 75, step: 1 }
      },
      microWorkflowId: {
        type: "enum",
        extractors: [{ kind: "body" }],
        validation: { allowedValues: ["retirement_pension_task_orchestration"], outOfRange: "reject" }
      }
    },
    policies: [
      {
        id: "no_execution_without_explicit_authorization",
        when: "result.formalApplicationStarted == false",
        effect: "confirmation_required"
      }
    ],
    workflows: [
      {
        id: "retirement_pension_task_orchestration",
        mutableFields: ["pensionTaskIntent", "requestedWithdrawalAmount", "targetRetirementAge"],
        steps: [
          { id: "resolve_intent", uiHint: "scenario_comparison" },
          { id: "load_context", uiHint: "scenario_comparison" },
          { id: "compose_dynamic_steps", uiHint: "scenario_comparison" },
          { id: "next_decision_gate", uiHint: "scenario_comparison" }
        ]
      }
    ],
    apiBindings: [
      {
        id: "cn_profile",
        source: "valueStream.cnRetirementProfile",
        params: { customerId: "$input.customerId" },
        provides: ["age", "identityStatus", "ordinaryRetirementAge"]
      },
      {
        id: "cn_portfolio",
        source: "valueStream.cnPensionPortfolio",
        params: { customerId: "$input.customerId" },
        provides: ["totalBalance", "accounts"]
      }
    ]
  }
];

export function getCapabilityPackage(id: string) {
  return capabilityPackages.find((capabilityPackage) => capabilityPackage.id === id);
}
