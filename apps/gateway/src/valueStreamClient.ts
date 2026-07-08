const valueStreamBaseUrl =
  process.env.VALUE_STREAM_BASE_URL ?? process.env.MOCK_API_BASE_URL ?? "http://localhost:4101";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${valueStreamBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`Value stream request failed: ${response.status} ${path}`);
  }
  return response.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${valueStreamBaseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`Value stream request failed: ${response.status} ${path}`);
  }
  return response.json() as Promise<T>;
}

export type Profile = {
  customerId: string;
  name: string;
  age: number;
  annualIncome: number;
  householdStatus: string;
  retirementGoalAge: number;
  targetAnnualRetirementSpending: number;
  riskProfile: string;
  segment: string;
};

export type Account = {
  accountId: string;
  type: string;
  status: string;
  balance: number;
  eligibleForContribution: boolean;
  wrapper: string;
};

export type Holdings = {
  allocation: Record<string, number>;
  topHoldings: string[];
  riskExposure: string;
};

export type Contribution = {
  currentRate: number;
  yearToDateEmployeeContribution: number;
  yearToDateEmployerContribution: number;
  history: Array<{ year: number; rate: number }>;
};

export type TaxLimit = {
  taxYear: string;
  pensionAnnualAllowance: number;
  moneyPurchaseAnnualAllowance: number;
  mpaaTriggered: boolean;
  remainingPensionAnnualAllowance: number;
};

export type IsaSubscription = {
  taxYear: string;
  annualIsaAllowance: number;
  stocksAndSharesIsaSubscribed: number;
  cashIsaSubscribed: number;
  flexibleIsaReplacementAvailable: number;
  uninvestedCash: number;
};

export type DrawdownProfile = {
  pensionPot: number;
  crystallisedAmount: number;
  taxFreeCashTaken: number;
  currentAnnualIncome: number;
  selectedPathwayGoal: string;
  taxableIncomeTaken: boolean;
};

export type WorkplacePlan = {
  employerName: string;
  employeeContributionRate: number;
  employerContributionRate: number;
  employerMatchMaxRate: number;
  salarySacrificeAvailable: boolean;
  planDefaultFund: string;
};

export type AdviserPortfolio = {
  adviserFirmId: string;
  adviserFirmName: string;
  modelPortfolioName: string;
  targetRiskProfile: string;
  lastSuitabilityReviewDate: string;
  driftScore: number;
  rebalanceRecommended: boolean;
  platformAssets: number;
};

export type Projection = {
  customerId: string;
  targetRetirementAge: number;
  contributionRate: number;
  projectedBalance: number;
  estimatedAnnualIncome: number;
  incomeReplacementRatio: number;
  goalProbability: number;
};

export const valueStreamClient = {
  profile: (customerId: string) => getJson<Profile>(`/profile/${customerId}`),
  accounts: (customerId: string) => getJson<Account[]>(`/accounts/${customerId}`),
  holdings: (customerId: string) => getJson<Holdings>(`/holdings/${customerId}`),
  contributions: (customerId: string) => getJson<Contribution>(`/contributions/${customerId}`),
  taxLimits: (customerId: string) => getJson<TaxLimit>(`/tax-limits/${customerId}`),
  isaSubscriptions: (customerId: string) => getJson<IsaSubscription>(`/isa-subscriptions/${customerId}`),
  drawdown: (customerId: string) => getJson<DrawdownProfile>(`/drawdown/${customerId}`),
  workplacePlan: (customerId: string) => getJson<WorkplacePlan>(`/workplace-plan/${customerId}`),
  adviserPortfolio: (customerId: string) => getJson<AdviserPortfolio>(`/adviser-portfolio/${customerId}`),
  projection: (body: {
    customerId: string;
    targetRetirementAge?: number;
    contributionRate?: number;
    currentBalance?: number;
    targetAnnualRetirementSpending?: number;
  }) => postJson<Projection>("/projection", body)
};
