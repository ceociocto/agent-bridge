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
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function totalBalance(accounts: Array<{ balance: number }>) {
  return accounts.reduce((sum, account) => sum + account.balance, 0);
}

export async function composeRetirementReadiness(
  capability: CapabilityDefinition,
  input: CapabilityInvokeInput
): Promise<AgentReadableResult> {
  const compositionSteps: AuditStep[] = [];

  const [profile, accounts, holdings] = await Promise.all([
    valueStreamClient.profile(input.customerId),
    valueStreamClient.accounts(input.customerId),
    valueStreamClient.holdings(input.customerId)
  ]);
  compositionSteps.push({
    name: "load_customer_context",
    status: "completed",
    detail: "Composed Profile, Accounts, and Holdings APIs for customer context."
  });

  const currentBalance = totalBalance(accounts);
  const projection = await valueStreamClient.projection({
    customerId: input.customerId,
    targetRetirementAge: input.targetRetirementAge ?? profile.retirementGoalAge,
    contributionRate: undefined,
    currentBalance,
    targetAnnualRetirementSpending: profile.targetAnnualRetirementSpending
  });
  compositionSteps.push({
    name: "run_projection",
    status: "completed",
    detail: "Projection API calculated future balance, annual income, and goal probability."
  });

  const policyChecks = evaluatePolicy(capability);
  const audit = createAuditRecord({
    capabilityId: capability.id,
    customerId: input.customerId,
    sourceApis: capability.requiredApis,
    policyChecks,
    compositionSteps
  });

  const readinessScore = projection.goalProbability;
  const incomeGap = Math.max(profile.targetAnnualRetirementSpending - projection.estimatedAnnualIncome, 0);

  return {
    capability: capability.id,
    summary: `${profile.name} is projected to cover ${projection.incomeReplacementRatio}% of target retirement spending at age ${projection.targetRetirementAge}.`,
    customer: {
      customer_id: profile.customerId,
      name: profile.name,
      age: profile.age,
      target_retirement_age: projection.targetRetirementAge
    },
    readiness_score: readinessScore,
    projected_balance: projection.projectedBalance,
    estimated_annual_retirement_income: projection.estimatedAnnualIncome,
    income_gap: incomeGap,
    key_factors: [
      `Current retirement balance is ${money(currentBalance)}.`,
      `Portfolio allocation is ${holdings.allocation.equities}% equities and ${holdings.allocation.bonds}% bonds.`,
      `Risk profile is ${profile.riskProfile}.`,
      `Projection assumes target spending of ${money(profile.targetAnnualRetirementSpending)}.`
    ],
    risks: [
      incomeGap > 0
        ? `Projected income gap is ${money(incomeGap)} per year under current assumptions.`
        : "Projected income covers the target spending assumption.",
      holdings.allocation.equities > 60
        ? "Portfolio has meaningful equity exposure and may be sensitive to market volatility."
        : "Portfolio allocation is relatively balanced for the target horizon.",
      projection.targetRetirementAge < 62
        ? "Retiring before 62 reduces accumulation years and may increase longevity risk."
        : "Target retirement age preserves more accumulation years."
    ],
    next_actions: [
      { action: "review_target_spending", recommended: true },
      { action: "run_alternative_retirement_age", suggested_age: projection.targetRetirementAge + 2 },
      { action: "evaluate_contribution_optimization", recommended: readinessScore < 90 }
    ],
    source_apis: capability.requiredApis,
    policy_checks: policyChecks,
    audit_trace_id: audit.traceId
  };
}

export async function composeContributionOptimization(
  capability: CapabilityDefinition,
  input: CapabilityInvokeInput
): Promise<AgentReadableResult> {
  const compositionSteps: AuditStep[] = [];

  const [profile, accounts, contribution, taxLimit] = await Promise.all([
    valueStreamClient.profile(input.customerId),
    valueStreamClient.accounts(input.customerId),
    valueStreamClient.contributions(input.customerId),
    valueStreamClient.taxLimits(input.customerId)
  ]);
  compositionSteps.push({
    name: "load_contribution_context",
    status: "completed",
    detail: "Composed Profile, Accounts, Contribution, and Tax Limits APIs."
  });

  const currentBalance = totalBalance(accounts);
  const currentProjection = await valueStreamClient.projection({
    customerId: input.customerId,
    targetRetirementAge: profile.retirementGoalAge,
    contributionRate: contribution.currentRate,
    currentBalance,
    targetAnnualRetirementSpending: profile.targetAnnualRetirementSpending
  });

  const maxRecommendedRate = taxLimit.catchUpEligible ? 15 : 12;
  const recommendedRate =
    input.desiredContributionRate ??
    Math.min(maxRecommendedRate, contribution.currentRate + (taxLimit.remainingContributionRoom > 6000 ? 3 : 1));

  const recommendedAnnualContribution = Math.round(profile.annualIncome * (recommendedRate / 100));
  const allowedLimit = taxLimit.annual401kLimit + taxLimit.catchUpLimit;
  const staysWithinLimit =
    contribution.yearToDateEmployeeContribution + recommendedAnnualContribution / 2 <= allowedLimit;

  const improvedProjection = await valueStreamClient.projection({
    customerId: input.customerId,
    targetRetirementAge: profile.retirementGoalAge,
    contributionRate: recommendedRate,
    currentBalance,
    targetAnnualRetirementSpending: profile.targetAnnualRetirementSpending
  });
  compositionSteps.push({
    name: "compare_projection_scenarios",
    status: "completed",
    detail: "Projection API compared current and recommended contribution scenarios."
  });

  const policyChecks = evaluatePolicy(capability);
  const audit = createAuditRecord({
    capabilityId: capability.id,
    customerId: input.customerId,
    sourceApis: capability.requiredApis,
    policyChecks,
    compositionSteps
  });

  return {
    capability: capability.id,
    summary: `Increasing ${profile.name}'s contribution rate from ${contribution.currentRate}% to ${recommendedRate}% may improve readiness from ${currentProjection.goalProbability}% to ${improvedProjection.goalProbability}%.`,
    customer: {
      customer_id: profile.customerId,
      name: profile.name,
      age: profile.age
    },
    current_contribution_rate: `${contribution.currentRate}%`,
    recommended_contribution_rate: `${recommendedRate}%`,
    estimated_impact: {
      readiness_score_before: currentProjection.goalProbability,
      readiness_score_after: improvedProjection.goalProbability,
      projected_additional_retirement_assets:
        improvedProjection.projectedBalance - currentProjection.projectedBalance
    },
    constraints_checked: [
      {
        name: "annual_contribution_limit",
        status: staysWithinLimit ? "passed" : "requires_review",
        detail: `Allowed 2026 limit is ${money(allowedLimit)} including catch-up where applicable.`
      },
      {
        name: "catch_up_eligibility",
        status: "passed",
        detail: taxLimit.catchUpEligible ? "Customer is catch-up eligible." : "Customer is not catch-up eligible."
      },
      {
        name: "plan_eligibility",
        status: "passed",
        detail: `${accounts.filter((account) => account.eligibleForContribution).length} account(s) are eligible for contribution.`
      }
    ],
    next_actions: [
      {
        action: "confirm_contribution_change",
        requires_customer_confirmation: true,
        proposed_rate: `${recommendedRate}%`
      },
      { action: "show_cashflow_impact", requires_additional_calculation: true },
      { action: "schedule_advisor_review", recommended: improvedProjection.goalProbability < 90 }
    ],
    source_apis: capability.requiredApis,
    policy_checks: policyChecks,
    audit_trace_id: audit.traceId
  };
}
