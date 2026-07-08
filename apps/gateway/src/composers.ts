import type {
  AgentReadableResult,
  AuditStep,
  CapabilityDefinition,
  CapabilityInvokeInput
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
  compositionSteps: AuditStep[]
) {
  const audit = createAuditRecord({
    capabilityId: capability.id,
    customerId: input.customerId,
    sourceApis: capability.requiredApis,
    policyChecks,
    compositionSteps
  });

  return {
    source_apis: capability.requiredApis,
    policy_checks: policyChecks,
    audit_trace_id: audit.traceId
  };
}

export async function composeIsaAllowanceReview(
  capability: CapabilityDefinition,
  input: CapabilityInvokeInput
): Promise<AgentReadableResult> {
  const compositionSteps: AuditStep[] = [];
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

  const subscribed = isa.stocksAndSharesIsaSubscribed + isa.cashIsaSubscribed;
  const remainingAllowance = Math.max(isa.annualIsaAllowance - subscribed, 0);
  const plannedSubscription = input.plannedIsaSubscription ?? Math.min(remainingAllowance, 5000);
  const wouldExceedAllowance = plannedSubscription > remainingAllowance + isa.flexibleIsaReplacementAvailable;
  const isaAccount = accounts.find((account) => account.wrapper === "ISA");
  const base = createResultBase(capability, input, evaluatePolicy(capability), compositionSteps);

  return {
    capability: capability.id,
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
      `Current Stocks and Shares ISA subscriptions are ${money(isa.stocksAndSharesIsaSubscribed)}.`,
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

  const policyChecks = evaluatePolicy(capability);
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

  const policyChecks = evaluatePolicy(capability);
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

  compositionSteps.push({
    name: "load_adviser_platform_context",
    status: "completed",
    detail: "Composed Adviser Entitlement, Client Profile, Platform Accounts, Model Portfolio, and Holdings APIs."
  });

  const requestedFirm = input.adviserFirmId ?? adviserPortfolio.adviserFirmId;
  const entitled = requestedFirm === adviserPortfolio.adviserFirmId;
  const requestedRisk = input.riskProfile ?? profile.riskProfile;
  const riskMismatch = requestedRisk !== adviserPortfolio.targetRiskProfile;
  const platformAccounts = accounts.filter((account) => account.wrapper === "Adviser Platform");
  const policyChecks = evaluatePolicy(capability);
  if (!entitled) {
    policyChecks.push({
      name: "adviser_firm_entitlement",
      status: "requires_confirmation",
      detail: "Requested adviser firm does not match the synthetic servicing firm for this client."
    });
  }
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
