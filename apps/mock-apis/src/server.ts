import cors from "cors";
import express from "express";
import {
  accounts,
  contributions,
  holdings,
  isCustomerId,
  profiles,
  taxLimits
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
  res.json({ service: "mock-apis", status: "ok" });
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
    balance * Math.pow(1.052, yearsToRetirement) +
      annualContribution * (((Math.pow(1.052, yearsToRetirement) - 1) / 0.052) || 0)
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
  console.log(`Mock value stream APIs listening on http://localhost:${port}`);
});
