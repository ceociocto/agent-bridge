import { z } from "zod";
import type { CapabilityId, IntentResolution } from "@agent-bridge/shared";
import { capabilities } from "./catalog.js";

const llmResolutionSchema = z.object({
  status: z.enum(["resolved", "needs_clarification", "unsupported"]).default("resolved"),
  intent: z.string().min(1),
  capabilityId: z.enum(["retirement_readiness_assessment", "contribution_optimization"]).nullable().optional(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1),
  questions: z.array(z.string()).optional()
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

  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 8000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const capabilityList = capabilities.map((capability) => ({
    id: capability.id,
    name: capability.name,
    description: capability.description,
    businessOutcome: capability.businessOutcome,
    requiredApis: capability.requiredApis,
    policy: capability.policy,
    examplePrompts: capability.examplePrompts
  }));

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    signal: controller.signal,
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an intent resolver for a governed financial capability gateway. " +
            "Return only JSON with keys: status, intent, capabilityId, confidence, reasoning, questions. " +
            "Use status resolved only when one catalog capability clearly fits. " +
            "Use needs_clarification when the user goal is financial but too vague. " +
            "Use unsupported when no catalog capability fits."
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
    })
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

  return {
    status: parsed.status,
    intent: parsed.intent,
    capabilityId: (parsed.capabilityId ?? undefined) as CapabilityId | undefined,
    confidence: parsed.confidence,
    reasoning: parsed.reasoning,
    resolver: "llm",
    questions: parsed.questions,
    availableCapabilities: parsed.status === "unsupported" ? capabilities.map((capability) => capability.id) : undefined
  };
}
