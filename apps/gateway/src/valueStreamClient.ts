const mockApiBaseUrl = process.env.MOCK_API_BASE_URL ?? "http://localhost:4101";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${mockApiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`Mock API request failed: ${response.status} ${path}`);
  }
  return response.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${mockApiBaseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`Mock API request failed: ${response.status} ${path}`);
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
};

export type Account = {
  accountId: string;
  type: string;
  status: string;
  balance: number;
  eligibleForContribution: boolean;
  employerMatch: string;
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
  taxYear: number;
  annual401kLimit: number;
  catchUpEligible: boolean;
  catchUpLimit: number;
  remainingContributionRoom: number;
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
  projection: (body: {
    customerId: string;
    targetRetirementAge?: number;
    contributionRate?: number;
    currentBalance?: number;
    targetAnnualRetirementSpending?: number;
  }) => postJson<Projection>("/projection", body)
};
