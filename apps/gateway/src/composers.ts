import type {
  AgentReadableResult,
  AuditStep,
  CapabilityDefinition,
  CapabilityInvokeInput,
  IsaWorkflowId
} from "@agent-bridge/shared";
import { createAuditRecord } from "./audit.js";
import { evaluatePolicy } from "./policy.js";
import { valueStreamClient } from "./valueStreamClient.js";

function money(value: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0
  }).format(value);
}

function totalBalance(accounts: Array<{ balance: number }>) {
  return accounts.reduce((sum, account) => sum + account.balance, 0);
}

function createResultBase(
  capability: CapabilityDefinition,
  input: CapabilityInvokeInput,
  policyChecks: AuditStep[],
  compositionSteps: AuditStep[],
  sourceApis = capability.requiredApis
) {
  const audit = createAuditRecord({
    capabilityId: capability.id,
    capabilityVersion: capability.version,
    customerId: input.customerId,
    sourceApis,
    policyChecks,
    compositionSteps
  });

  // Reflect the actual audit write in the policy check rather than the static
  // "will be generated" assertion that evaluatePolicy emits before the record exists.
  if (capability.policy.auditRequired) {
    for (const check of policyChecks) {
      if (check.name === "audit_required") {
        check.status = "completed";
        check.detail = `Audit trace ${audit.traceId} recorded for this capability invocation.`;
      }
    }
  }

  return {
    source_apis: sourceApis,
    policy_checks: policyChecks,
    audit_trace_id: audit.traceId
  };
}

// Minimal result for entitlement/eligibility denials: still audited, but no
// product-sensitive fields are disclosed.
function gatedResult(
  capability: CapabilityDefinition,
  input: CapabilityInvokeInput,
  policyChecks: AuditStep[],
  summary: string,
  nextActions: Array<Record<string, unknown>>
): AgentReadableResult {
  const base = createResultBase(capability, input, policyChecks, []);
  return {
    capability: capability.id,
    summary,
    next_actions: nextActions,
    ...base
  };
}

export async function composeIsaAllowanceReview(
  capability: CapabilityDefinition,
  input: CapabilityInvokeInput
): Promise<AgentReadableResult> {
  const workflow = isaWorkflowRegistry[input.isaWorkflowId ?? "isa_full_review"];
  return workflow.execute(capability, input);
}

type IsaWorkflowDefinition = {
  id: IsaWorkflowId;
  reason: string;
  sourceApis: string[];
  execute: (capability: CapabilityDefinition, input: CapabilityInvokeInput) => Promise<AgentReadableResult>;
};

const isaWorkflowRegistry: Record<IsaWorkflowId, IsaWorkflowDefinition> = {
  isa_allowance_remaining: {
    id: "isa_allowance_remaining",
    reason: "The request is scoped to remaining ISA allowance, so portfolio APIs are not needed.",
    sourceApis: ["Profile API", "ISA Subscription API"],
    execute: composeIsaAllowanceRemaining
  },
  isa_subscription_feasibility: {
    id: "isa_subscription_feasibility",
    reason: "The request asks whether a planned ISA subscription fits within allowance and account context.",
    sourceApis: ["Profile API", "Accounts API", "ISA Subscription API"],
    execute: composeIsaSubscriptionFeasibility
  },
  isa_cash_drag_review: {
    id: "isa_cash_drag_review",
    reason: "The request is about uninvested cash or allocation, so holdings context is required.",
    sourceApis: ["Profile API", "Accounts API", "ISA Subscription API", "Holdings API"],
    execute: composeIsaCashDragReview
  },
  isa_full_review: {
    id: "isa_full_review",
    reason: "The request needs the complete ISA review path or no narrower workflow was selected.",
    sourceApis: ["Profile API", "Accounts API", "ISA Subscription API", "Holdings API"],
    execute: composeIsaFullReview
  }
};

function isaWorkflowFields(workflow: IsaWorkflowDefinition) {
  return {
    workflow_id: workflow.id,
    sub_intent: workflow.id,
    composition_mode: "capability_internal_micro_workflow",
    workflow_reasoning: workflow.reason
  };
}

function addIsaWorkflowSelectionStep(workflow: IsaWorkflowDefinition, compositionSteps: AuditStep[]) {
  compositionSteps.push({
    name: "select_isa_micro_workflow",
    status: "completed",
    detail: `Selected ${workflow.id}. ${workflow.reason}`
  });
}

function isaAllowanceSnapshot(isa: {
  annualIsaAllowance: number;
  stocksAndSharesIsaSubscribed: number;
  cashIsaSubscribed: number;
  flexibleIsaReplacementAvailable: number;
}) {
  const subscribed = isa.stocksAndSharesIsaSubscribed + isa.cashIsaSubscribed;
  const remainingAllowance = Math.max(isa.annualIsaAllowance - subscribed, 0);
  return {
    subscribed,
    remainingAllowance
  };
}

async function composeIsaAllowanceRemaining(
  capability: CapabilityDefinition,
  input: CapabilityInvokeInput
): Promise<AgentReadableResult> {
  const workflow = isaWorkflowRegistry.isa_allowance_remaining;
  const compositionSteps: AuditStep[] = [];
  addIsaWorkflowSelectionStep(workflow, compositionSteps);

  const [profile, isa] = await Promise.all([
    valueStreamClient.profile(input.customerId),
    valueStreamClient.isaSubscriptions(input.customerId)
  ]);

  compositionSteps.push({
    name: "load_isa_allowance_context",
    status: "completed",
    detail: "Composed Profile and ISA Subscription APIs."
  });

  const { subscribed, remainingAllowance } = isaAllowanceSnapshot(isa);
  const base = createResultBase(capability, input, evaluatePolicy(capability), compositionSteps, workflow.sourceApis);

  return {
    capability: capability.id,
    ...isaWorkflowFields(workflow),
    summary: `${profile.name} has ${money(remainingAllowance)} of ${isa.taxYear} ISA allowance remaining.`,
    customer: {
      customer_id: profile.customerId,
      name: profile.name,
      segment: profile.segment
    },
    tax_year: isa.taxYear,
    isa_allowance: money(isa.annualIsaAllowance),
    subscribed_so_far: money(subscribed),
    remaining_allowance: money(remainingAllowance),
    next_actions: [
      { action: "ask_if_customer_wants_to_check_a_planned_subscription", recommended: true },
      { action: "review_cash_allocation", recommended: false }
    ],
    ...base
  };
}

async function composeIsaSubscriptionFeasibility(
  capability: CapabilityDefinition,
  input: CapabilityInvokeInput
): Promise<AgentReadableResult> {
  const workflow = isaWorkflowRegistry.isa_subscription_feasibility;
  const compositionSteps: AuditStep[] = [];
  addIsaWorkflowSelectionStep(workflow, compositionSteps);

  const [profile, accounts, isa] = await Promise.all([
    valueStreamClient.profile(input.customerId),
    valueStreamClient.accounts(input.customerId),
    valueStreamClient.isaSubscriptions(input.customerId)
  ]);

  compositionSteps.push({
    name: "load_isa_subscription_context",
    status: "completed",
    detail: "Composed Profile, Accounts, and ISA Subscription APIs."
  });

  const { subscribed, remainingAllowance } = isaAllowanceSnapshot(isa);
  const plannedSubscription = input.plannedIsaSubscription ?? Math.min(remainingAllowance, 5000);
  const wouldExceedAllowance = plannedSubscription > remainingAllowance + isa.flexibleIsaReplacementAvailable;
  const isaAccount = accounts.find((account) => account.wrapper === "ISA");
  const base = createResultBase(capability, input, evaluatePolicy(capability), compositionSteps, workflow.sourceApis);

  return {
    capability: capability.id,
    ...isaWorkflowFields(workflow),
    summary: wouldExceedAllowance
      ? `${profile.name}'s planned ISA subscription of ${money(plannedSubscription)} requires review before submission.`
      : `${profile.name}'s planned ISA subscription of ${money(plannedSubscription)} fits within the remaining allowance.`,
    customer: {
      customer_id: profile.customerId,
      name: profile.name,
      segment: profile.segment
    },
    tax_year: isa.taxYear,
    isa_allowance: money(isa.annualIsaAllowance),
    subscribed_so_far: money(subscribed),
    remaining_allowance: money(remainingAllowance),
    planned_subscription_check: {
      planned_subscription: money(plannedSubscription),
      status: wouldExceedAllowance ? "requires_review" : "within_allowance",
      detail: wouldExceedAllowance
        ? "The planned subscription is above the remaining allowance and flexible replacement room."
        : "The planned subscription fits within the remaining ISA allowance."
    },
    account_context: {
      has_stocks_and_shares_isa: Boolean(isaAccount),
      isa_balance: money(isaAccount?.balance ?? 0),
      eligible_for_contribution: isaAccount?.eligibleForContribution ?? false
    },
    risks: [
      wouldExceedAllowance
        ? "Potential ISA over-subscription if the planned amount is submitted unchanged."
        : "No allowance breach detected for the planned subscription."
    ],
    next_actions: [
      { action: "confirm_subscription_amount", required: wouldExceedAllowance },
      { action: "continue_to_subscription_journey", requires_customer_confirmation: true }
    ],
    ...base
  };
}

async function composeIsaCashDragReview(
  capability: CapabilityDefinition,
  input: CapabilityInvokeInput
): Promise<AgentReadableResult> {
  const workflow = isaWorkflowRegistry.isa_cash_drag_review;
  const compositionSteps: AuditStep[] = [];
  addIsaWorkflowSelectionStep(workflow, compositionSteps);

  const [profile, accounts, holdings, isa] = await Promise.all([
    valueStreamClient.profile(input.customerId),
    valueStreamClient.accounts(input.customerId),
    valueStreamClient.holdings(input.customerId),
    valueStreamClient.isaSubscriptions(input.customerId)
  ]);

  compositionSteps.push({
    name: "load_isa_cash_drag_context",
    status: "completed",
    detail: "Composed Profile, Accounts, ISA Subscription, and Holdings APIs."
  });

  const { subscribed, remainingAllowance } = isaAllowanceSnapshot(isa);
  const isaAccount = accounts.find((account) => account.wrapper === "ISA");
  const cashAboveDemoThreshold = holdings.allocation.cash > 10;
  const base = createResultBase(capability, input, evaluatePolicy(capability), compositionSteps, workflow.sourceApis);

  return {
    capability: capability.id,
    ...isaWorkflowFields(workflow),
    summary: `${profile.name}'s ISA has ${money(isa.uninvestedCash)} uninvested cash and a ${
      holdings.allocation.cash
    }% cash allocation.`,
    customer: {
      customer_id: profile.customerId,
      name: profile.name,
      risk_profile: profile.riskProfile
    },
    tax_year: isa.taxYear,
    subscribed_so_far: money(subscribed),
    remaining_allowance: money(remainingAllowance),
    portfolio_context: {
      isa_balance: money(isaAccount?.balance ?? 0),
      uninvested_cash: money(isa.uninvestedCash),
      cash_allocation: `${holdings.allocation.cash}%`,
      top_holdings: holdings.topHoldings
    },
    risks: [
      cashAboveDemoThreshold
        ? "Cash allocation is above the demo threshold and should be reviewed against the investment objective."
        : "Cash allocation is within the demo threshold.",
      `The customer risk profile is ${profile.riskProfile}; cash level should be assessed against that profile.`
    ],
    next_actions: [
      { action: "review_cash_allocation", recommended: cashAboveDemoThreshold },
      { action: "compare_stocks_and_shares_isa_options", recommended: true }
    ],
    ...base
  };
}

async function composeIsaFullReview(
  capability: CapabilityDefinition,
  input: CapabilityInvokeInput
): Promise<AgentReadableResult> {
  const workflow = isaWorkflowRegistry.isa_full_review;
  const compositionSteps: AuditStep[] = [];
  addIsaWorkflowSelectionStep(workflow, compositionSteps);

  const [profile, accounts, holdings, isa] = await Promise.all([
    valueStreamClient.profile(input.customerId),
    valueStreamClient.accounts(input.customerId),
    valueStreamClient.holdings(input.customerId),
    valueStreamClient.isaSubscriptions(input.customerId)
  ]);

  compositionSteps.push({
    name: "load_personal_investing_context",
    status: "completed",
    detail: "Composed Profile, Accounts, ISA Subscription, and Holdings APIs."
  });

  const { subscribed, remainingAllowance } = isaAllowanceSnapshot(isa);
  const plannedSubscription = input.plannedIsaSubscription ?? Math.min(remainingAllowance, 5000);
  const wouldExceedAllowance = plannedSubscription > remainingAllowance + isa.flexibleIsaReplacementAvailable;
  const isaAccount = accounts.find((account) => account.wrapper === "ISA");
  const base = createResultBase(capability, input, evaluatePolicy(capability), compositionSteps, workflow.sourceApis);

  return {
    capability: capability.id,
    ...isaWorkflowFields(workflow),
    summary: `${profile.name} has ${money(remainingAllowance)} of ${isa.taxYear} ISA allowance remaining before any new subscription.`,
    customer: {
      customer_id: profile.customerId,
      name: profile.name,
      segment: profile.segment,
      risk_profile: profile.riskProfile
    },
    tax_year: isa.taxYear,
    isa_allowance: money(isa.annualIsaAllowance),
    subscribed_so_far: money(subscribed),
    remaining_allowance: money(remainingAllowance),
    planned_subscription_check: {
      planned_subscription: money(plannedSubscription),
      status: wouldExceedAllowance ? "requires_review" : "within_allowance",
      detail: wouldExceedAllowance
        ? "The planned subscription is above the remaining allowance and should not be submitted without adjustment."
        : "The planned subscription fits within the remaining ISA allowance."
    },
    portfolio_context: {
      isa_balance: money(isaAccount?.balance ?? 0),
      uninvested_cash: money(isa.uninvestedCash),
      cash_allocation: `${holdings.allocation.cash}%`,
      top_holdings: holdings.topHoldings
    },
    key_factors: [
      `The 2026/27 ISA allowance used in this synthetic demo is ${money(isa.annualIsaAllowance)}.`,
      `Stocks and Shares ISA subscriptions are ${money(isa.stocksAndSharesIsaSubscribed)}${
        isa.cashIsaSubscribed > 0 ? ` plus ${money(isa.cashIsaSubscribed)} in a Cash ISA` : ""
      }, totalling ${money(subscribed)} used of the allowance.`,
      `Uninvested ISA cash is ${money(isa.uninvestedCash)}, which may create cash drag for a balanced investor.`
    ],
    risks: [
      wouldExceedAllowance
        ? "Potential ISA over-subscription if the planned amount is submitted unchanged."
        : "No allowance breach detected for the planned subscription.",
      holdings.allocation.cash > 10
        ? "Cash allocation is above the demo threshold and should be reviewed against the investment objective."
        : "Cash allocation is within the demo threshold."
    ],
    next_actions: [
      { action: "confirm_subscription_amount", required: wouldExceedAllowance },
      { action: "review_cash_allocation", recommended: holdings.allocation.cash > 10 },
      { action: "compare_stocks_and_shares_isa_options", recommended: true }
    ],
    ...base
  };
}

export async function composeSippDrawdownPathwayReview(
  capability: CapabilityDefinition,
  input: CapabilityInvokeInput
): Promise<AgentReadableResult> {
  const compositionSteps: AuditStep[] = [];
  const [profile, accounts, drawdown, taxLimit] = await Promise.all([
    valueStreamClient.profile(input.customerId),
    valueStreamClient.accounts(input.customerId),
    valueStreamClient.drawdown(input.customerId),
    valueStreamClient.taxLimits(input.customerId)
  ]);

  const policyChecks = evaluatePolicy(capability);

  const hasDrawdownArrangement =
    accounts.some((account) => account.type === "pension_drawdown_account") || drawdown.pensionPot > 0;
  if (!hasDrawdownArrangement) {
    policyChecks.push({
      name: "product_eligibility",
      status: "denied",
      detail: `${profile.name} holds no SIPP drawdown arrangement; the drawdown pathway review is not applicable.`
    });
    return gatedResult(
      capability,
      input,
      policyChecks,
      `${profile.name} has no SIPP drawdown arrangement to review.`,
      [
        { action: "confirm_product_holding", required: true },
        {
          action: "explore_personal_investing_isa_allowance_review",
          recommended: profile.segment === "personal_investing"
        }
      ]
    );
  }

  policyChecks.push({
    name: "product_eligibility",
    status: "passed",
    detail: `${profile.name} holds a SIPP drawdown arrangement.`
  });

  compositionSteps.push({
    name: "load_sipp_drawdown_context",
    status: "completed",
    detail: "Composed Profile, Accounts, Drawdown, and Pension Allowance APIs."
  });

  const requestedIncome = input.plannedDrawdownIncome ?? drawdown.currentAnnualIncome;
  const drawdownBalance = accounts.find((account) => account.type === "pension_drawdown_account")?.balance ?? 0;
  const withdrawalRate = drawdownBalance > 0 ? requestedIncome / drawdownBalance : 0;
  const selectedGoal = input.drawdownGoal ?? drawdown.selectedPathwayGoal;

  const projection = await valueStreamClient.projection({
    customerId: input.customerId,
    targetRetirementAge: input.targetRetirementAge ?? profile.retirementGoalAge,
    contributionRate: 0,
    currentBalance: drawdown.pensionPot,
    targetAnnualRetirementSpending: profile.targetAnnualRetirementSpending
  });
  compositionSteps.push({
    name: "run_retirement_income_projection",
    status: "completed",
    detail: "Retirement Projection API estimated income coverage under the selected drawdown context."
  });

  const base = createResultBase(capability, input, policyChecks, compositionSteps);
  const withdrawalStatus = withdrawalRate > 0.05 ? "requires_review" : "within_demo_threshold";

  return {
    capability: capability.id,
    summary: `${profile.name}'s requested SIPP drawdown income of ${money(requestedIncome)} is ${Math.round(
      withdrawalRate * 1000
    ) / 10}% of the drawdown account balance.`,
    customer: {
      customer_id: profile.customerId,
      name: profile.name,
      age: profile.age,
      target_retirement_age: profile.retirementGoalAge
    },
    pathway_review: {
      selected_goal: selectedGoal,
      current_goal: drawdown.selectedPathwayGoal,
      drawdown_balance: money(drawdownBalance),
      requested_annual_income: money(requestedIncome),
      withdrawal_status: withdrawalStatus
    },
    allowance_context: {
      mpaa_triggered: taxLimit.mpaaTriggered,
      money_purchase_annual_allowance: money(taxLimit.moneyPurchaseAnnualAllowance),
      pension_annual_allowance: money(taxLimit.pensionAnnualAllowance)
    },
    projected_income_coverage: {
      estimated_annual_income: money(projection.estimatedAnnualIncome),
      target_annual_spending: money(profile.targetAnnualRetirementSpending),
      income_replacement_ratio: `${projection.incomeReplacementRatio}%`
    },
    risks: [
      withdrawalRate > 0.05
        ? "Requested withdrawals exceed the demo sustainability threshold and should be reviewed."
        : "Requested withdrawals are within the demo sustainability threshold.",
      taxLimit.mpaaTriggered
        ? "MPAA has been triggered, limiting future money purchase pension contributions in this demo."
        : "MPAA is not marked as triggered in the synthetic record.",
      selectedGoal === "cash_out"
        ? "Full cash-out goals can create tax and longevity risks and require explicit confirmation."
        : "Pathway goal does not imply full immediate encashment."
    ],
    next_actions: [
      { action: "confirm_drawdown_instruction", requires_customer_confirmation: true },
      { action: "show_tax_implication_estimate", recommended: requestedIncome > 0 },
      { action: "compare_investment_pathway_goal", selected_goal: selectedGoal }
    ],
    ...base
  };
}

export async function composeWorkplacePensionContributionGuidance(
  capability: CapabilityDefinition,
  input: CapabilityInvokeInput
): Promise<AgentReadableResult> {
  const compositionSteps: AuditStep[] = [];
  const [profile, accounts, plan, contribution, taxLimit] = await Promise.all([
    valueStreamClient.profile(input.customerId),
    valueStreamClient.accounts(input.customerId),
    valueStreamClient.workplacePlan(input.customerId),
    valueStreamClient.contributions(input.customerId),
    valueStreamClient.taxLimits(input.customerId)
  ]);

  const policyChecks = evaluatePolicy(capability);

  const hasWorkplacePension = accounts.some((account) => account.wrapper === "Workplace Pension");
  if (!hasWorkplacePension) {
    policyChecks.push({
      name: "product_eligibility",
      status: "denied",
      detail: `${profile.name} holds no workplace pension on record; contribution guidance is not applicable.`
    });
    return gatedResult(
      capability,
      input,
      policyChecks,
      `${profile.name} has no workplace pension to optimise.`,
      [
        { action: "confirm_product_holding", required: true },
        {
          action: "explore_personal_investing_isa_allowance_review",
          recommended: profile.segment === "personal_investing"
        },
        {
          action: "explore_sipp_drawdown_pathway_review",
          recommended: profile.segment === "sipp_drawdown"
        }
      ]
    );
  }

  policyChecks.push({
    name: "product_eligibility",
    status: "passed",
    detail: `${profile.name} holds a workplace pension.`
  });

  compositionSteps.push({
    name: "load_workplace_pension_context",
    status: "completed",
    detail: "Composed Profile, Workplace Plan, Contribution, Accounts, and Pension Allowance APIs."
  });

  const currentBalance = totalBalance(accounts.filter((account) => account.wrapper === "Workplace Pension"));
  const recommendedRate =
    input.desiredContributionRate ??
    Math.min(plan.employerMatchMaxRate, contribution.currentRate + 2, 15);
  const employerMatchCaptured = recommendedRate >= plan.employerMatchMaxRate;
  const annualEmployeeContribution = Math.round(profile.annualIncome * (recommendedRate / 100));
  const annualEmployerContribution = Math.round(
    profile.annualIncome * (Math.min(recommendedRate, plan.employerMatchMaxRate) / 100)
  );
  const projectedTotalInput = annualEmployeeContribution + annualEmployerContribution;
  const allowanceStatus =
    taxLimit.mpaaTriggered && projectedTotalInput > taxLimit.moneyPurchaseAnnualAllowance
      ? "mpaa_requires_review"
      : projectedTotalInput > taxLimit.remainingPensionAnnualAllowance
        ? "annual_allowance_requires_review"
        : "within_allowance";

  const projection = await valueStreamClient.projection({
    customerId: input.customerId,
    targetRetirementAge: input.targetRetirementAge ?? profile.retirementGoalAge,
    contributionRate: recommendedRate,
    currentBalance,
    targetAnnualRetirementSpending: profile.targetAnnualRetirementSpending
  });
  compositionSteps.push({
    name: "compare_workplace_contribution_scenario",
    status: "completed",
    detail: "Retirement Projection API estimated outcome for the proposed contribution rate."
  });

  const base = createResultBase(capability, input, policyChecks, compositionSteps);

  return {
    capability: capability.id,
    summary: `A ${recommendedRate}% workplace pension contribution would ${
      employerMatchCaptured ? "capture" : "not yet capture"
    } the full employer match for ${profile.name}.`,
    customer: {
      customer_id: profile.customerId,
      name: profile.name,
      employer: plan.employerName,
      plan_default_fund: plan.planDefaultFund
    },
    current_contribution_rate: `${contribution.currentRate}%`,
    recommended_contribution_rate: `${recommendedRate}%`,
    employer_match: {
      current_employer_rate: `${plan.employerContributionRate}%`,
      maximum_match_rate: `${plan.employerMatchMaxRate}%`,
      full_match_captured: employerMatchCaptured,
      salary_sacrifice_available: plan.salarySacrificeAvailable
    },
    allowance_check: {
      tax_year: taxLimit.taxYear,
      projected_total_input: money(projectedTotalInput),
      status: allowanceStatus
    },
    projected_outcome: {
      target_retirement_age: projection.targetRetirementAge,
      projected_balance: money(projection.projectedBalance),
      goal_probability: `${projection.goalProbability}%`
    },
    next_actions: [
      {
        action: "confirm_contribution_change",
        requires_customer_confirmation: true,
        proposed_rate: `${recommendedRate}%`
      },
      { action: "review_salary_sacrifice", recommended: plan.salarySacrificeAvailable },
      { action: "check_annual_allowance_with_adviser", recommended: allowanceStatus !== "within_allowance" }
    ],
    ...base
  };
}

export async function composeAdviserModelPortfolioReview(
  capability: CapabilityDefinition,
  input: CapabilityInvokeInput
): Promise<AgentReadableResult> {
  const compositionSteps: AuditStep[] = [];
  const [profile, accounts, holdings, adviserPortfolio] = await Promise.all([
    valueStreamClient.profile(input.customerId),
    valueStreamClient.accounts(input.customerId),
    valueStreamClient.holdings(input.customerId),
    valueStreamClient.adviserPortfolio(input.customerId)
  ]);

  const platformAccounts = accounts.filter((account) => account.wrapper === "Adviser Platform");
  const policyChecks = evaluatePolicy(capability);
  const requestedFirm = input.adviserFirmId;
  const entitled = platformAccounts.length > 0 && requestedFirm === adviserPortfolio.adviserFirmId;

  // Entitlement is verified from product holding + an explicit caller-supplied firm id.
  // The client's own servicing firm must never be silently adopted as the "requested"
  // firm, and a non-advised customer must not receive adviser platform disclosure.
  if (platformAccounts.length === 0) {
    policyChecks.push({
      name: "adviser_firm_entitlement",
      status: "denied",
      detail: `${profile.name} holds no adviser platform portfolio; adviser capability entitlement cannot be established.`
    });
    return gatedResult(
      capability,
      input,
      policyChecks,
      `Adviser model portfolio review is not available for ${profile.name}; no adviser platform holding on record.`,
      [{ action: "confirm_adviser_platform_entitlement", required: true }]
    );
  }

  if (!requestedFirm) {
    policyChecks.push({
      name: "adviser_firm_entitlement",
      status: "requires_confirmation",
      detail: "Caller must supply an adviserFirmId so the gateway can verify entitlement before disclosing adviser platform data."
    });
    return gatedResult(
      capability,
      input,
      policyChecks,
      "Adviser firm entitlement could not be verified; adviserFirmId was not supplied. Portfolio details withheld.",
      [{ action: "supply_adviser_firm_id", required: true }]
    );
  }

  if (!entitled) {
    policyChecks.push({
      name: "adviser_firm_entitlement",
      status: "requires_confirmation",
      detail: `Requested adviser firm ${requestedFirm} does not match the servicing firm ${adviserPortfolio.adviserFirmId} for this client.`
    });
    return gatedResult(
      capability,
      input,
      policyChecks,
      `Requested adviser firm ${requestedFirm} is not the servicing firm for ${profile.name}; portfolio details withheld pending entitlement review.`,
      [{ action: "confirm_adviser_firm_entitlement", required: true }]
    );
  }

  policyChecks.push({
    name: "adviser_firm_entitlement",
    status: "passed",
    detail: `Caller firm ${requestedFirm} matches the servicing firm for ${profile.name}.`
  });

  compositionSteps.push({
    name: "load_adviser_platform_context",
    status: "completed",
    detail: "Composed Adviser Entitlement, Client Profile, Platform Accounts, Model Portfolio, and Holdings APIs."
  });

  const requestedRisk = input.riskProfile ?? profile.riskProfile;
  const riskMismatch = requestedRisk !== adviserPortfolio.targetRiskProfile;
  const base = createResultBase(capability, input, policyChecks, compositionSteps);

  return {
    capability: capability.id,
    summary: `${profile.name}'s ${adviserPortfolio.modelPortfolioName} review shows a drift score of ${adviserPortfolio.driftScore}.`,
    client: {
      customer_id: profile.customerId,
      name: profile.name,
      requested_risk_profile: requestedRisk,
      model_target_risk_profile: adviserPortfolio.targetRiskProfile
    },
    adviser_context: {
      adviser_firm_id: adviserPortfolio.adviserFirmId,
      adviser_firm_name: adviserPortfolio.adviserFirmName,
      requested_firm_id: requestedFirm,
      entitlement_status: entitled ? "matched" : "requires_review"
    },
    portfolio_review: {
      model_portfolio_name: adviserPortfolio.modelPortfolioName,
      platform_assets: money(adviserPortfolio.platformAssets),
      account_count: platformAccounts.length,
      last_suitability_review_date: adviserPortfolio.lastSuitabilityReviewDate,
      drift_score: adviserPortfolio.driftScore,
      rebalance_recommended: adviserPortfolio.rebalanceRecommended,
      allocation: holdings.allocation,
      top_holdings: holdings.topHoldings
    },
    risks: [
      riskMismatch
        ? "Requested risk profile differs from the model target risk profile."
        : "Requested risk profile aligns with the model target.",
      adviserPortfolio.driftScore > 5
        ? "Portfolio drift is above the demo threshold and a rebalance review is recommended."
        : "Portfolio drift is within the demo threshold.",
      entitled ? "Adviser firm entitlement matched." : "Adviser firm entitlement requires review before disclosure."
    ],
    next_actions: [
      { action: "prepare_review_pack", recommended: entitled },
      { action: "rebalance_review", recommended: adviserPortfolio.rebalanceRecommended },
      { action: "refresh_suitability_review", recommended: riskMismatch }
    ],
    ...base
  };
}
