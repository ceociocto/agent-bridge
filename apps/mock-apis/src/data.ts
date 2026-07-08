export type CustomerId = "UK001" | "UK002" | "UK003";

export const profiles = {
  UK001: {
    customerId: "UK001",
    name: "Amelia Clarke",
    age: 38,
    annualIncome: 85000,
    householdStatus: "partnered",
    retirementGoalAge: 62,
    targetAnnualRetirementSpending: 42000,
    riskProfile: "balanced",
    segment: "personal_investing"
  },
  UK002: {
    customerId: "UK002",
    name: "Martin Hughes",
    age: 58,
    annualIncome: 128000,
    householdStatus: "married",
    retirementGoalAge: 63,
    targetAnnualRetirementSpending: 56000,
    riskProfile: "growth",
    segment: "sipp_drawdown"
  },
  UK003: {
    customerId: "UK003",
    name: "Priya Shah",
    age: 45,
    annualIncome: 97000,
    householdStatus: "single",
    retirementGoalAge: 65,
    targetAnnualRetirementSpending: 48000,
    riskProfile: "balanced",
    segment: "workplace_and_advised"
  }
} as const;

export const accounts = {
  UK001: [
    {
      accountId: "ISA-UK001",
      type: "stocks_and_shares_isa",
      status: "active",
      balance: 74200,
      eligibleForContribution: true,
      wrapper: "ISA"
    },
    {
      accountId: "GIA-UK001",
      type: "investment_account",
      status: "active",
      balance: 23600,
      eligibleForContribution: false,
      wrapper: "General Investment Account"
    }
  ],
  UK002: [
    {
      accountId: "SIPP-UK002",
      type: "self_invested_personal_pension",
      status: "active",
      balance: 612000,
      eligibleForContribution: true,
      wrapper: "SIPP"
    },
    {
      accountId: "DRAW-UK002",
      type: "pension_drawdown_account",
      status: "active",
      balance: 188000,
      eligibleForContribution: false,
      wrapper: "SIPP Drawdown"
    }
  ],
  UK003: [
    {
      accountId: "WPP-UK003",
      type: "workplace_pension",
      status: "active",
      balance: 214000,
      eligibleForContribution: true,
      wrapper: "Workplace Pension"
    },
    {
      accountId: "ADV-UK003",
      type: "adviser_platform_portfolio",
      status: "active",
      balance: 365000,
      eligibleForContribution: false,
      wrapper: "Adviser Platform"
    }
  ]
} as const;

export const holdings = {
  UK001: {
    allocation: {
      equities: 62,
      bonds: 22,
      cash: 11,
      alternatives: 5
    },
    topHoldings: ["Fidelity Index World Fund", "Fidelity Cash Fund", "UK Short-Dated Bond Fund"],
    riskExposure: "balanced_growth_with_cash_drag"
  },
  UK002: {
    allocation: {
      equities: 48,
      bonds: 36,
      cash: 12,
      alternatives: 4
    },
    topHoldings: ["Fidelity Multi Asset Income Fund", "Strategic Bond Fund", "Global Dividend Fund"],
    riskExposure: "income_oriented_with_sequence_risk"
  },
  UK003: {
    allocation: {
      equities: 57,
      bonds: 31,
      cash: 7,
      alternatives: 5
    },
    topHoldings: ["Balanced Model Portfolio", "Global Equity Fund", "UK Corporate Bond Fund"],
    riskExposure: "balanced_model_with_minor_drift"
  }
} as const;

export const isaSubscriptions = {
  UK001: {
    taxYear: "2026/27",
    annualIsaAllowance: 20000,
    stocksAndSharesIsaSubscribed: 9500,
    cashIsaSubscribed: 2500,
    flexibleIsaReplacementAvailable: 0,
    uninvestedCash: 8200
  },
  UK002: {
    taxYear: "2026/27",
    annualIsaAllowance: 20000,
    stocksAndSharesIsaSubscribed: 0,
    cashIsaSubscribed: 0,
    flexibleIsaReplacementAvailable: 0,
    uninvestedCash: 0
  },
  UK003: {
    taxYear: "2026/27",
    annualIsaAllowance: 20000,
    stocksAndSharesIsaSubscribed: 20000,
    cashIsaSubscribed: 0,
    flexibleIsaReplacementAvailable: 0,
    uninvestedCash: 1800
  }
} as const;

export const drawdownProfiles = {
  UK001: {
    pensionPot: 0,
    crystallisedAmount: 0,
    taxFreeCashTaken: 0,
    currentAnnualIncome: 0,
    selectedPathwayGoal: "keep_invested",
    taxableIncomeTaken: false
  },
  UK002: {
    pensionPot: 800000,
    crystallisedAmount: 188000,
    taxFreeCashTaken: 47000,
    currentAnnualIncome: 12000,
    selectedPathwayGoal: "take_income_within_five_years",
    taxableIncomeTaken: true
  },
  UK003: {
    pensionPot: 214000,
    crystallisedAmount: 0,
    taxFreeCashTaken: 0,
    currentAnnualIncome: 0,
    selectedPathwayGoal: "keep_invested",
    taxableIncomeTaken: false
  }
} as const;

export const workplacePlans = {
  UK001: {
    employerName: "Northbank Media Ltd",
    employeeContributionRate: 5,
    employerContributionRate: 3,
    employerMatchMaxRate: 5,
    salarySacrificeAvailable: false,
    planDefaultFund: "FutureWise Growth"
  },
  UK002: {
    employerName: "Hughes Consulting LLP",
    employeeContributionRate: 8,
    employerContributionRate: 4,
    employerMatchMaxRate: 4,
    salarySacrificeAvailable: true,
    planDefaultFund: "FutureWise Income"
  },
  UK003: {
    employerName: "Mercury Retail Group",
    employeeContributionRate: 6,
    employerContributionRate: 4,
    employerMatchMaxRate: 8,
    salarySacrificeAvailable: true,
    planDefaultFund: "FutureWise Balanced"
  }
} as const;

export const contributions = {
  UK001: {
    currentRate: 5,
    yearToDateEmployeeContribution: 3540,
    yearToDateEmployerContribution: 2124,
    history: [
      { year: 2024, rate: 4 },
      { year: 2025, rate: 5 },
      { year: 2026, rate: 5 }
    ]
  },
  UK002: {
    currentRate: 8,
    yearToDateEmployeeContribution: 10240,
    yearToDateEmployerContribution: 5120,
    history: [
      { year: 2024, rate: 8 },
      { year: 2025, rate: 8 },
      { year: 2026, rate: 8 }
    ]
  },
  UK003: {
    currentRate: 6,
    yearToDateEmployeeContribution: 5820,
    yearToDateEmployerContribution: 3880,
    history: [
      { year: 2024, rate: 5 },
      { year: 2025, rate: 6 },
      { year: 2026, rate: 6 }
    ]
  }
} as const;

export const taxLimits = {
  UK001: {
    taxYear: "2026/27",
    pensionAnnualAllowance: 60000,
    moneyPurchaseAnnualAllowance: 10000,
    mpaaTriggered: false,
    remainingPensionAnnualAllowance: 54336
  },
  UK002: {
    taxYear: "2026/27",
    pensionAnnualAllowance: 60000,
    moneyPurchaseAnnualAllowance: 10000,
    mpaaTriggered: true,
    remainingPensionAnnualAllowance: 0
  },
  UK003: {
    taxYear: "2026/27",
    pensionAnnualAllowance: 60000,
    moneyPurchaseAnnualAllowance: 10000,
    mpaaTriggered: false,
    remainingPensionAnnualAllowance: 50200
  }
} as const;

export const adviserPortfolios = {
  UK001: {
    adviserFirmId: "FA-100",
    adviserFirmName: "Oakmere Financial Planning",
    modelPortfolioName: "Fidelity WealthBuilder Balanced",
    targetRiskProfile: "balanced",
    lastSuitabilityReviewDate: "2026-02-14",
    driftScore: 3.2,
    rebalanceRecommended: false,
    platformAssets: 97800
  },
  UK002: {
    adviserFirmId: "FA-200",
    adviserFirmName: "South Coast Wealth",
    modelPortfolioName: "Fidelity WealthBuilder Income",
    targetRiskProfile: "growth",
    lastSuitabilityReviewDate: "2025-11-07",
    driftScore: 6.8,
    rebalanceRecommended: true,
    platformAssets: 800000
  },
  UK003: {
    adviserFirmId: "FA-100",
    adviserFirmName: "Oakmere Financial Planning",
    modelPortfolioName: "Fidelity WealthBuilder Balanced",
    targetRiskProfile: "balanced",
    lastSuitabilityReviewDate: "2025-09-20",
    driftScore: 5.6,
    rebalanceRecommended: true,
    platformAssets: 365000
  }
} as const;

export function isCustomerId(value: string): value is CustomerId {
  return value === "UK001" || value === "UK002" || value === "UK003";
}
