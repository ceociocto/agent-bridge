import { loadLocalEnv } from "./env.js";
import cors from "cors";
import express from "express";
import { capabilityInvokeSchema } from "@agent-bridge/shared";
import { getAuditRecord } from "./audit.js";
import { capabilities, getCapability } from "./catalog.js";
import { composeContributionOptimization, composeRetirementReadiness } from "./composers.js";
import { resolveIntent } from "./intent.js";
import { isLlmIntentResolverConfigured } from "./llmIntentResolver.js";

loadLocalEnv();

const app = express();
const port = Number(process.env.PORT ?? 4100);

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    service: "gateway",
    status: "ok",
    intentResolver: isLlmIntentResolverConfigured() ? "llm" : "rules"
  });
});

app.get("/capabilities", (_req, res) => {
  res.json({
    interface: "simulated-mcp-gateway",
    capabilities
  });
});

app.post("/intent/resolve", async (req, res, next) => {
  try {
    const prompt = String(req.body?.prompt ?? "");
    if (!prompt.trim()) {
      res.status(400).json({ error: "prompt is required" });
      return;
    }

    res.json(await resolveIntent(prompt));
  } catch (error) {
    next(error);
  }
});

app.post("/capabilities/:capabilityId/invoke", async (req, res, next) => {
  try {
    const capability = getCapability(req.params.capabilityId);
    if (!capability) {
      res.status(404).json({ error: "Unknown capability" });
      return;
    }

    const parsed = capabilityInvokeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid capability input", issues: parsed.error.issues });
      return;
    }

    if (capability.id === "retirement_readiness_assessment") {
      res.json(await composeRetirementReadiness(capability, parsed.data));
      return;
    }

    res.json(await composeContributionOptimization(capability, parsed.data));
  } catch (error) {
    next(error);
  }
});

app.post("/agent/request", async (req, res, next) => {
  try {
    const prompt = String(req.body?.prompt ?? "");
    if (!prompt.trim()) {
      res.status(400).json({ error: "prompt is required" });
      return;
    }

    const resolution = await resolveIntent(prompt);
    const capability = getCapability(resolution.capabilityId);
    if (!capability) {
      res.status(500).json({ error: "Resolved capability was not found" });
      return;
    }

    const parsed = capabilityInvokeSchema.safeParse({
      customerId: req.body?.customerId,
      targetRetirementAge: req.body?.targetRetirementAge,
      desiredContributionRate: req.body?.desiredContributionRate
    });
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request input", issues: parsed.error.issues });
      return;
    }

    const result =
      capability.id === "retirement_readiness_assessment"
        ? await composeRetirementReadiness(capability, parsed.data)
        : await composeContributionOptimization(capability, parsed.data);

    res.json({
      prompt,
      resolution,
      capability,
      result
    });
  } catch (error) {
    next(error);
  }
});

app.get("/audit/:traceId", (req, res) => {
  const record = getAuditRecord(req.params.traceId);
  if (!record) {
    res.status(404).json({ error: "Audit trace not found" });
    return;
  }
  res.json(record);
});

app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(500).json({
    error: "Gateway request failed",
    detail: error.message
  });
});

app.listen(port, () => {
  console.log(`Agent capability gateway listening on http://localhost:${port}`);
});
