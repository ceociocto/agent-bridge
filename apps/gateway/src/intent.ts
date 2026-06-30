import { capabilityIds, type IntentResolution } from "@agent-bridge/shared";
import { resolveIntentWithLlm } from "./llmIntentResolver.js";

function resolveIntentWithConservativeFallback(): IntentResolution {
  return {
    status: "unsupported",
    intent: "unclassified request",
    confidence: 0,
    reasoning:
      "The gateway could not confidently map this request to a published capability, so it did not invoke downstream APIs.",
    resolver: "fallback",
    availableCapabilities: [...capabilityIds]
  };
}

export async function resolveIntent(prompt: string): Promise<IntentResolution> {
  try {
    const llmResolution = await resolveIntentWithLlm(prompt);
    if (llmResolution) return llmResolution;
  } catch (error) {
    console.warn(
      "LLM intent resolver failed; using conservative unsupported fallback:",
      error instanceof Error ? error.message : error
    );
  }

  return resolveIntentWithConservativeFallback();
}
