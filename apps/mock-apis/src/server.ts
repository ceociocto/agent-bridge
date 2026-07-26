import cors from "cors";
import express from "express";
import {
  adviserPortfolios,
  accounts,
  cnPensionProfiles,
  cnWithdrawalRules,
  contributions,
  drawdownProfiles,
  holdings,
  isCustomerId,
  isaSubscriptions,
  profiles,
  taxLimits,
  workplacePlans
} from "./data.js";

const app = express();
const port = Number(process.env.PORT ?? 4101);

app.use(cors());
app.use(express.json());

function getCustomer(req: express.Request, res: express.Response) {
  const { customerId } = req.params;
  if (!isCustomerId(customerId)) {
    res.status(404).json({ error: "Unknown customer id" });
    return undefined;
  }
  return customerId;
}

app.get("/health", (_req, res) => {
  res.json({ service: "synthetic-fidelity-uk-value-streams", status: "ok" });
});

app.get("/profile/:customerId", (req, res) => {
  const customerId = getCustomer(req, res);
  if (!customerId) return;
  res.json(profiles[customerId]);
});

app.get("/accounts/:customerId", (req, res) => {
  const customerId = getCustomer(req, res);
  if (!customerId) return;
  res.json(accounts[customerId]);
});

app.get("/holdings/:customerId", (req, res) => {
  const customerId = getCustomer(req, res);
  if (!customerId) return;
  res.json(holdings[customerId]);
});

app.get("/contributions/:customerId", (req, res) => {
  const customerId = getCustomer(req, res);
  if (!customerId) return;
  res.json(contributions[customerId]);
});

app.get("/tax-limits/:customerId", (req, res) => {
  const customerId = getCustomer(req, res);
  if (!customerId) return;
  res.json(taxLimits[customerId]);
});

app.get("/isa-subscriptions/:customerId", (req, res) => {
  const customerId = getCustomer(req, res);
  if (!customerId) return;
  res.json(isaSubscriptions[customerId]);
});

app.get("/drawdown/:customerId", (req, res) => {
  const customerId = getCustomer(req, res);
  if (!customerId) return;
  res.json(drawdownProfiles[customerId]);
});

app.get("/workplace-plan/:customerId", (req, res) => {
  const customerId = getCustomer(req, res);
  if (!customerId) return;
  res.json(workplacePlans[customerId]);
});

app.get("/adviser-portfolio/:customerId", (req, res) => {
  const customerId = getCustomer(req, res);
  if (!customerId) return;
  res.json(adviserPortfolios[customerId]);
});

app.get("/cn-retirement-profile/:customerId", (req, res) => {
  const customerId = getCustomer(req, res);
  if (!customerId) return;
  if (customerId !== "CN001") {
    res.status(404).json({ error: "No CN retirement profile for customer" });
    return;
  }
  res.json(cnPensionProfiles[customerId]);
});

app.get("/cn-pension-portfolio/:customerId", (req, res) => {
  const customerId = getCustomer(req, res);
  if (!customerId) return;
  const customerAccounts = accounts[customerId].filter((account) =>
    ["basic_pension", "enterprise_annuity", "personal_pension"].includes(account.type)
  );
  if (!customerAccounts.length) {
    res.status(404).json({ error: "No CN pension portfolio for customer" });
    return;
  }
  const total = customerAccounts.reduce((sum, account) => sum + account.balance, 0);
  res.json({
    customerId,
    totalBalance: total,
    accounts: customerAccounts.map((account) => ({
      ...account,
      ratio: Math.round((account.balance / total) * 100)
    }))
  });
});

app.get("/cn-withdrawal-eligibility/:customerId", (req, res) => {
  const customerId = getCustomer(req, res);
  if (!customerId) return;
  if (customerId !== "CN001") {
    res.status(404).json({ error: "No CN withdrawal rules for customer" });
    return;
  }
  res.json({
    customerId,
    status: "eligible_to_explore",
    routes: cnWithdrawalRules[customerId].eligibleRoutes,
    formalApplicationStarted: false
  });
});

app.post("/cn-withdrawal-impact", (req, res) => {
  const { customerId, amount } = req.body as { customerId?: string; amount?: number };
  if (!customerId || !isCustomerId(customerId) || customerId !== "CN001") {
    res.status(400).json({ error: "Valid CN customerId is required" });
    return;
  }
  const requestedAmount = amount ?? 100000;
  const total = accounts[customerId].reduce((sum, account) => sum + account.balance, 0);
  const estimatedTaxLow = Math.round(requestedAmount * 0.05);
  const estimatedTaxHigh = Math.round(requestedAmount * 0.08);
  res.json({
    customerId,
    requestedAmount,
    estimatedNetLow: requestedAmount - estimatedTaxHigh,
    estimatedNetHigh: requestedAmount - estimatedTaxLow,
    projectedBalanceAfter: Math.max(total - requestedAmount, 0),
    monthlyIncomeReduction: Math.round(requestedAmount / 161),
    revocabilityWindowMinutes: 30
  });
});

app.post("/cn-retirement-claim-options", (req, res) => {
  const { customerId, targetRetirementAge } = req.body as { customerId?: string; targetRetirementAge?: number };
  if (!customerId || !isCustomerId(customerId) || customerId !== "CN001") {
    res.status(400).json({ error: "Valid CN customerId is required" });
    return;
  }
  const profile = profiles[customerId];
  const total = accounts[customerId].reduce((sum, account) => sum + account.balance, 0);
  const baseAge = targetRetirementAge ?? profile.retirementGoalAge;
  const options = [60, 63, 65].map((age) => {
    const years = Math.max(age - profile.age, 0);
    const projectedBalance = Math.round(total * Math.pow(1.045, years));
    return {
      retirementAge: age,
      projectedBalance,
      estimatedMonthlyIncome: Math.round((projectedBalance * 0.045) / 12),
      fitScore: Math.max(68, Math.min(96, 74 + (age - 60) * 5 + (age === baseAge ? 3 : 0)))
    };
  });
  res.json({
    customerId,
    targetRetirementAge: baseAge,
    options,
    claimStrategies: [
      {
        id: "monthly",
        label: "按月领取",
        summary: "稳定现金流，适合保留长期退休收入。"
      },
      {
        id: "hybrid",
        label: "部分一次性 + 月领",
        summary: "兼顾短期资金需求和长期收入。"
      }
    ],
    formalClaimStarted: false
  });
});

app.post("/projection", (req, res) => {
  const {
    customerId,
    targetRetirementAge,
    contributionRate,
    currentBalance,
    targetAnnualRetirementSpending
  } = req.body as {
    customerId?: string;
    targetRetirementAge?: number;
    contributionRate?: number;
    currentBalance?: number;
    targetAnnualRetirementSpending?: number;
  };

  if (!customerId || !isCustomerId(customerId)) {
    res.status(400).json({ error: "Valid customerId is required" });
    return;
  }

  const profile = profiles[customerId];
  const yearsToRetirement = Math.max((targetRetirementAge ?? profile.retirementGoalAge) - profile.age, 0);
  const balance = currentBalance ?? accounts[customerId].reduce((sum, account) => sum + account.balance, 0);
  const rate = contributionRate ?? contributions[customerId].currentRate;
  const annualContribution = profile.annualIncome * (rate / 100);
  const projectedBalance = Math.round(
    balance * Math.pow(1.047, yearsToRetirement) +
      annualContribution * (((Math.pow(1.047, yearsToRetirement) - 1) / 0.047) || 0)
  );
  const targetSpending = targetAnnualRetirementSpending ?? profile.targetAnnualRetirementSpending;
  const estimatedAnnualIncome = Math.round(projectedBalance * 0.04);
  const incomeReplacementRatio = Math.round((estimatedAnnualIncome / targetSpending) * 100);
  const goalProbability = Math.max(45, Math.min(96, Math.round(incomeReplacementRatio * 0.92)));

  res.json({
    customerId,
    targetRetirementAge: targetRetirementAge ?? profile.retirementGoalAge,
    contributionRate: rate,
    projectedBalance,
    estimatedAnnualIncome,
    incomeReplacementRatio,
    goalProbability
  });
});

app.listen(port, () => {
  console.log(`Synthetic Fidelity UK value stream APIs listening on http://localhost:${port}`);
});
