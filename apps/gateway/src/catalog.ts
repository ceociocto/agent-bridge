import type { CapabilityDefinition } from "@agent-bridge/shared";

export const capabilities: CapabilityDefinition[] = [
  {
    id: "personal_investing_isa_allowance_review",
    version: "2026.07.1",
    owner: "Personal Investing Value Stream",
    status: "active",
    name: "Personal Investing ISA Allowance Review",
    description:
      "Assess a UK retail investor's Stocks and Shares ISA usage, remaining allowance, cash drag, and next actions.",
    businessOutcome:
      "A tax-wrapper-aware ISA summary with remaining allowance, investment account context, and execution-safe next actions.",
    requiredApis: ["Profile API", "Accounts API", "ISA Subscription API", "Holdings API"],
    inputSchema: {
      customerId: "string",
      plannedIsaSubscription: "number optional",
      microWorkflowId: "enum optional: isa_subscription_feasibility",
      isaWorkflowId:
        "enum optional: isa_allowance_remaining | isa_subscription_feasibility | isa_cash_drag_review | isa_full_review"
    },
    outputSchema: {
      summary: "string",
      workflow_id: "string",
      composition_mode: "string",
      tax_year: "string",
      planned_subscription_check: "object",
      portfolio_context: "object",
      next_actions: "array"
    },
    dataClassification: "confidential",
    executionPlan: {
      mode: "configured_composition",
      steps: [
        {
          id: "select_isa_micro_workflow",
          type: "policy_check",
          description:
            "Select a controlled ISA scenario workflow from the prompt or explicit isaWorkflowId before calling downstream APIs."
        },
        {
          id: "load_personal_investing_context",
          type: "api_call",
          uses: "Workflow-specific subset of Profile API + Accounts API + ISA Subscription API + Holdings API",
          description:
            "Load only the API set needed by the selected ISA workflow: allowance, subscription feasibility, cash-drag review, or full review."
        },
        {
          id: "check_allowance",
          type: "calculation",
          description: "Compare planned ISA subscription against remaining allowance and flexible replacement room."
        },
        {
          id: "map_agent_result",
          type: "result_mapping",
          description: "Return allowance status, portfolio context, risks, next actions, and audit reference."
        }
      ]
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
    version: "2026.07.1",
    owner: "Retirement Value Stream",
    status: "active",
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
    outputSchema: {
      summary: "string",
      pathway_review: "object",
      allowance_context: "object",
      projected_income_coverage: "object",
      next_actions: "array"
    },
    dataClassification: "restricted",
    executionPlan: {
      mode: "configured_composition",
      steps: [
        {
          id: "verify_drawdown_holding",
          type: "policy_check",
          description: "Confirm the customer has an applicable SIPP drawdown arrangement before disclosure."
        },
        {
          id: "load_drawdown_context",
          type: "api_call",
          uses: "Profile API + Accounts API + Drawdown API + Pension Allowance API",
          description: "Load retirement, tax allowance, and drawdown context."
        },
        {
          id: "run_income_projection",
          type: "api_call",
          uses: "Retirement Projection API",
          description: "Project income coverage under the requested drawdown scenario."
        },
        {
          id: "gate_execution_actions",
          type: "policy_check",
          description: "Mark execution-oriented actions as requiring explicit customer confirmation."
        }
      ]
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
    version: "2026.07.1",
    owner: "Workplace Investing Value Stream",
    status: "active",
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
      targetRetirementAge: "number optional",
      microWorkflowId: "enum optional: retirement_goal_gap_projection"
    },
    outputSchema: {
      summary: "string",
      employer_match: "object",
      allowance_check: "object",
      projected_outcome: "object",
      next_actions: "array"
    },
    dataClassification: "restricted",
    executionPlan: {
      mode: "configured_composition",
      steps: [
        {
          id: "verify_workplace_holding",
          type: "policy_check",
          description: "Confirm a workplace pension relationship before contribution guidance is disclosed."
        },
        {
          id: "load_workplace_context",
          type: "api_call",
          uses: "Profile API + Workplace Plan API + Contribution API + Accounts API + Pension Allowance API",
          description: "Load current rates, employer match, salary sacrifice, balances, and allowance context."
        },
        {
          id: "compare_contribution_scenario",
          type: "api_call",
          uses: "Retirement Projection API",
          description: "Project retirement outcome under the proposed contribution rate."
        },
        {
          id: "map_confirmation_actions",
          type: "result_mapping",
          description: "Return recommendation evidence while keeping contribution changes confirmation-gated."
        }
      ]
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
    version: "2026.07.1",
    owner: "Adviser Platform Value Stream",
    status: "active",
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
      riskProfile: "string optional",
      microWorkflowId: "enum optional: adviser_review_pack_generation"
    },
    outputSchema: {
      summary: "string",
      adviser_context: "object",
      portfolio_review: "object",
      risks: "array",
      next_actions: "array"
    },
    dataClassification: "restricted",
    executionPlan: {
      mode: "configured_composition",
      steps: [
        {
          id: "verify_adviser_entitlement",
          type: "policy_check",
          description: "Require caller-supplied adviser firm entitlement before platform portfolio details are disclosed."
        },
        {
          id: "load_platform_context",
          type: "api_call",
          uses: "Client Profile API + Platform Accounts API + Model Portfolio API + Holdings API",
          description: "Load model portfolio, client profile, platform holdings, and suitability evidence."
        },
        {
          id: "assess_drift",
          type: "calculation",
          description: "Compare model target, requested risk profile, allocation, and drift score."
        },
        {
          id: "prepare_review_pack",
          type: "result_mapping",
          description: "Return adviser-readable evidence and audit-safe next actions."
        }
      ]
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
  },
  {
    id: "retirement_pension_task_orchestration",
    version: "2026.07.1",
    owner: "Retirement Platform Value Stream",
    status: "active",
    name: "养老金/公积金任务编排能力",
    description:
      "根据中文养老金或公积金用户意图，在同一业务能力内动态选择资金提取准备、退休领取规划或账户构成分析等受控 micro workflow。",
    businessOutcome:
      "一个可审计的资金服务工作区：先收敛用户目标，再按阶段库动态组合画像、账户、资格、到账测算、影响测算和领取策略组件。",
    requiredApis: [
      "CN Retirement Profile API",
      "CN Pension Portfolio API",
      "CN Withdrawal Eligibility API",
      "CN Withdrawal Impact API",
      "CN Retirement Claim Options API"
    ],
    inputSchema: {
      customerId: "string",
      pensionTaskIntent: "enum optional: cash_access_exploration | retirement_claim_planning | pot_composition",
      requestedWithdrawalAmount: "number optional",
      targetRetirementAge: "number optional",
      microWorkflowId: "enum optional: retirement_pension_task_orchestration"
    },
    outputSchema: {
      summary: "string",
      workflow_id: "string",
      task_plan: "array",
      pension_portfolio: "object",
      withdrawal_eligibility: "object optional",
      withdrawal_impact: "object optional",
      retirement_options: "object optional",
      next_actions: "array"
    },
    dataClassification: "restricted",
    executionPlan: {
      mode: "configured_composition",
      steps: [
        {
          id: "resolve_pension_task_intent",
          type: "policy_check",
          description: "把模糊中文表达收敛到公积金/养老金资金提取准备、退休领取规划或账户构成分析。"
        },
        {
          id: "load_known_pension_context",
          type: "api_call",
          uses: "CN Retirement Profile API + CN Pension Portfolio API",
          description: "先自动读取系统已知信息，避免把年龄、账户等已有参数重新问用户。"
        },
        {
          id: "compose_task_specific_workflow",
          type: "api_call",
          uses: "Workflow-specific subset of eligibility, impact, and claim option APIs",
          description: "根据任务意图只调用需要的业务 API，并生成可渲染 task_plan。"
        },
        {
          id: "gate_formal_execution",
          type: "policy_check",
          description: "提取或领取申请只暴露为下一步受控入口，不在探索/规划模式直接提交。"
        }
      ]
    },
    routing: {
      domains: ["养老金", "公积金", "住房公积金", "退休", "养老金提取", "公积金提取", "养老金领取", "pension", "retirement"],
      keywords: ["养老金", "公积金", "住房公积金", "缺钱", "提取", "取一部分", "退休", "领取", "什么时候退休", "账户构成", "比例"],
      positiveExamples: [
        "我最近缺钱，想看看能不能从公积金里取一部分。",
        "我想提取住房公积金还房贷。",
        "我准备退休，想知道什么时候退休最合适，以及应该怎样领取养老金。",
        "我的养老金中各项比例是多少？",
        "帮我比较养老金提取和退休领取方案。"
      ],
      negativeExamples: [
        "Can I add money to my ISA?",
        "Prepare an adviser model portfolio review.",
        "What is the weather tomorrow?"
      ],
      riskLevel: "high"
    },
    policy: {
      dataAccess: "recommendation",
      requiresCustomerConfirmation: true,
      auditRequired: true
    },
    examplePrompts: [
      "我最近缺钱，想看看能不能从养老金里取一部分。",
      "我准备退休，想知道什么时候退休最合适，以及应该怎样领取养老金。",
      "我的养老金中各项比例是多少？"
    ]
  }
];

export function getCapability(id: string) {
  return capabilities.find((capability) => capability.id === id);
}
