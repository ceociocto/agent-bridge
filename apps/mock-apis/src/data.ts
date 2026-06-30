export type CustomerId = "C001" | "C002";

export const profiles = {
  C001: {
    customerId: "C001",
    name: "Jerry Li",
    age: 45,
    annualIncome: 120000,
    householdStatus: "married",
    retirementGoalAge: 60,
    targetAnnualRetirementSpending: 88000,
    riskProfile: "moderate"
  },
  C002: {
    customerId: "C002",
    name: "Seajay Pei",
    age: 55,
    annualIncome: 165000,
    householdStatus: "single",
    retirementGoalAge: 65,
    targetAnnualRetirementSpending: 105000,
    riskProfile: "balanced"
  }
} as const;

export const accounts = {
  C001: [
    {
      accountId: "RA-401K-001",
      type: "401k",
      status: "active",
      balance: 385000,
      eligibleForContribution: true,
      employerMatch: "50% up to 6%"
    },
    {
      accountId: "RA-IRA-001",
      type: "traditional_ira",
      status: "active",
      balance: 72000,
      eligibleForContribution: true,
      employerMatch: "none"
    }
  ],
  C002: [
    {
      accountId: "RA-401K-002",
      type: "401k",
      status: "active",
      balance: 715000,
      eligibleForContribution: true,
      employerMatch: "100% up to 4%"
    },
    {
      accountId: "RA-BROKERAGE-002",
      type: "taxable_brokerage",
      status: "active",
      balance: 210000,
      eligibleForContribution: false,
      employerMatch: "none"
    }
  ]
} as const;

export const holdings = {
  C001: {
    allocation: {
      equities: 68,
      bonds: 23,
      cash: 5,
      alternatives: 4
    },
    topHoldings: ["US Total Market Fund", "International Equity Fund", "Core Bond Fund"],
    riskExposure: "moderate_market_volatility"
  },
  C002: {
    allocation: {
      equities: 55,
      bonds: 35,
      cash: 8,
      alternatives: 2
    },
    topHoldings: ["Target Date Income Fund", "Dividend Equity Fund", "Municipal Bond Fund"],
    riskExposure: "balanced_income_and_growth"
  }
} as const;

export const contributions = {
  C001: {
    currentRate: 8,
    yearToDateEmployeeContribution: 9600,
    yearToDateEmployerContribution: 3600,
    history: [
      { year: 2024, rate: 7 },
      { year: 2025, rate: 8 },
      { year: 2026, rate: 8 }
    ]
  },
  C002: {
    currentRate: 11,
    yearToDateEmployeeContribution: 18150,
    yearToDateEmployerContribution: 6600,
    history: [
      { year: 2024, rate: 10 },
      { year: 2025, rate: 11 },
      { year: 2026, rate: 11 }
    ]
  }
} as const;

export const taxLimits = {
  C001: {
    taxYear: 2026,
    annual401kLimit: 23500,
    catchUpEligible: false,
    catchUpLimit: 0,
    remainingContributionRoom: 13900
  },
  C002: {
    taxYear: 2026,
    annual401kLimit: 23500,
    catchUpEligible: true,
    catchUpLimit: 7500,
    remainingContributionRoom: 12850
  }
} as const;

export function isCustomerId(value: string): value is CustomerId {
  return value === "C001" || value === "C002";
}
