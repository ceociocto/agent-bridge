import { z } from "zod";
import type { CapabilityId, IntentResolution } from "@agent-bridge/shared";
import { capabilities } from "./catalog.js";

const llmResolutionSchema = z.object({
  status: z.enum(["resolved", "needs_clarification", "unsupported", "denied"]).default("resolved"),
  intent: z.string().min(1),
  capabilityId: z.enum(["retirement_readiness_assessment", "contribution_optimization"]).nullable().optional(),
  confidence: z.coerce.number().min(0).max(1),
  reasoning: z.string().min(1),
  questions: z.array(z.string()).nullable().optional(),
  policyDecision: z.preprocess(
    (value) => {
      if (value === null || value === undefined) return undefined;
      if (typeof value === "string") return undefined;
      return value;
    },
    z
      .object({
        name: z.string().min(1),
        status: z.enum(["passed", "completed", "requires_confirmation"]),
        detail: z.string().min(1)
      })
      .optional()
  )
});

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

function getLlmConfig() {
  const apiKey = process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY;
  const model = process.env.LLM_MODEL ?? process.env.OPENAI_MODEL;
  const baseUrl = (process.env.LLM_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1")
    .replace(/\/$/, "");

  if (!apiKey || !model) return null;
  return { apiKey, model, baseUrl };
}

function extractJson(content: string) {
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) return trimmed;

  const match = trimmed.match(/\{[\s\S]*\}/);
  return match?.[0] ?? trimmed;
}

export function isLlmIntentResolverConfigured() {
  return Boolean(getLlmConfig());
}

export async function resolveIntentWithLlm(prompt: string): Promise<IntentResolution | null> {
  const config = getLlmConfig();
  if (!config) return null;

  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 30000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const capabilityList = capabilities.map((capability) => ({
    id: capability.id,
    name: capability.name,
    description: capability.description,
    businessOutcome: capability.businessOutcome,
    policy: capability.policy,
    examplePrompts: capability.examplePrompts
  }));
  const minimumResolvedConfidence = Number(process.env.INTENT_RESOLUTION_MIN_CONFIDENCE ?? 0.62);
  const responseFormat = process.env.LLM_RESPONSE_FORMAT ?? "none";
  const requestBody: Record<string, unknown> = {
    model: config.model,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You are an intent resolver for a governed financial capability gateway. " +
          "Return only valid JSON with keys: status, intent, capabilityId, confidence, reasoning, questions, policyDecision. " +
          "Do not include markdown. Keep reasoning under 25 words. " +
          "Use status resolved only when one catalog capability clearly fits. " +
          "A request to set, raise, lower, or change a retirement contribution rate can fit contribution_optimization because that capability produces a recommendation or proposed rate; customer confirmation policy blocks execution later. " +
          "Do not mark a contribution-rate change request unsupported merely because the gateway does not execute the final transaction. " +
          "Use needs_clarification when the user goal is financial but too vague. " +
          "Use unsupported when no catalog capability fits. " +
          "Use denied when the request asks for regulated identifiers, full account numbers, credentials, private tax identifiers, or data exposure that violates data minimization. " +
          "When denied, include policyDecision with a concise policy name and a safe alternative. " +
          "Never invent a capability id; capabilityId must be null unless status is resolved."
      },
      {
        role: "user",
        content: JSON.stringify({
          prompt,
          capabilities: capabilityList,
          allowedCapabilityIds: capabilities.map((capability) => capability.id)
        })
      }
    ]
  };

  if (responseFormat !== "none") {
    requestBody.response_format = { type: responseFormat };
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    signal: controller.signal,
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(requestBody)
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(`LLM intent resolver returned ${response.status}`);
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("LLM intent resolver returned no message content");
  }

  const parsed = llmResolutionSchema.parse(JSON.parse(extractJson(content)));

  if (parsed.status === "resolved" && !parsed.capabilityId) {
    throw new Error("LLM intent resolver returned resolved without capabilityId");
  }

  if (parsed.status === "resolved" && parsed.confidence < minimumResolvedConfidence) {
    return {
      status: "needs_clarification",
      intent: parsed.intent,
      confidence: parsed.confidence,
      reasoning: `The model found a possible capability, but confidence ${parsed.confidence.toFixed(2)} is below the invocation threshold ${minimumResolvedConfidence.toFixed(2)}.`,
      resolver: "llm",
      questions: parsed.questions?.length
        ? parsed.questions
        : ["Can you clarify whether this is about retirement readiness or contribution optimization?"],
      availableCapabilities: capabilities.map((capability) => capability.id)
    };
  }

  return {
    status: parsed.status,
    intent: parsed.intent,
    capabilityId: (parsed.capabilityId ?? undefined) as CapabilityId | undefined,
    confidence: parsed.confidence,
    reasoning: parsed.reasoning,
    resolver: "llm",
    questions: parsed.questions ?? undefined,
    policyDecision: parsed.policyDecision ?? undefined,
    availableCapabilities:
      parsed.status === "unsupported" || parsed.status === "needs_clarification"
        ? capabilities.map((capability) => capability.id)
        : undefined
  };
}
