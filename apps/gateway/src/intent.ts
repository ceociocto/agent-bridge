import { capabilityIds, type CapabilityId, type IntentResolution } from "@agent-bridge/shared";
import { resolveIntentWithLlm } from "./llmIntentResolver.js";

const vagueFinancialPrompts = [
  "plan my money",
  "planning my money",
  "manage my money",
  "financial planning",
  "what should i do with my money"
];

const unsupportedPrompts = [
  "flight",
  "hotel",
  "restaurant",
  "weather",
  "movie",
  "book me",
  "order pizza",
  "travel"
];

const sensitiveDataPrompts = [
  "ssn",
  "social security",
  "tax id",
  "tin",
  "full account",
  "account number",
  "routing number"
];

const rules: Array<{
  capabilityId: CapabilityId;
  keywords: string[];
  reasoning: string;
}> = [
  {
    capabilityId: "contribution_optimization",
    keywords: ["contribution", "contribute", "401k", "increase", "limit", "tax", "match"],
    reasoning: "The request asks about contribution changes, tax limits, or plan contribution behavior."
  },
  {
    capabilityId: "retirement_readiness_assessment",
    keywords: ["retire", "retirement", "readiness", "ready", "age 60", "risk", "prepared"],
    reasoning: "The request asks for retirement readiness, target retirement age, or planning risks."
  }
];

function resolveGovernanceGuard(prompt: string): IntentResolution | null {
  const normalized = prompt.toLowerCase();

  if (sensitiveDataPrompts.some((keyword) => normalized.includes(keyword))) {
    return {
      status: "denied",
      intent: "sensitive data access",
      confidence: 0.98,
      reasoning: "The request asks for regulated identifiers or full account data that should not be exposed to an agent response.",
      resolver: "rules",
      policyDecision: {
        name: "sensitive_data_minimization",
        status: "requires_confirmation",
        detail: "Full identifiers are blocked in this POC. Use masked values or a consented secure workflow instead."
      }
    };
  }

  if (unsupportedPrompts.some((keyword) => normalized.includes(keyword))) {
    return {
      status: "unsupported",
      intent: "unsupported non-financial request",
      confidence: 0.9,
      reasoning: "The request does not map to any capability currently published in the gateway catalog.",
      resolver: "rules",
      availableCapabilities: [...capabilityIds]
    };
  }

  if (vagueFinancialPrompts.some((keyword) => normalized.includes(keyword))) {
    return {
      status: "needs_clarification",
      intent: "ambiguous financial planning request",
      confidence: 0.46,
      reasoning: "The request is financial, but it does not contain enough detail to choose a governed capability safely.",
      resolver: "rules",
      questions: [
        "Are you asking about retirement readiness or contribution optimization?",
        "Should the gateway evaluate a target retirement age or a contribution change?"
      ],
      availableCapabilities: [...capabilityIds]
    };
  }

  return null;
}

function resolveIntentWithRules(prompt: string): IntentResolution {
  const normalized = prompt.toLowerCase();

  const scored = rules.map((rule) => {
    const hits = rule.keywords.filter((keyword) => normalized.includes(keyword));
    return {
      ...rule,
      hits,
      score: hits.length
    };
  });

  const best = scored.sort((a, b) => b.score - a.score)[0];
  if (!best || best.score === 0) {
    return {
      status: "resolved",
      intent: "retirement planning assessment",
      capabilityId: "retirement_readiness_assessment",
      confidence: 0.52,
      reasoning: "No strong keyword match was found, so the gateway selected the safest read-only planning capability.",
      resolver: "rules"
    };
  }

  return {
    status: "resolved",
    intent: best.capabilityId.replaceAll("_", " "),
    capabilityId: best.capabilityId,
    confidence: Math.min(0.95, 0.62 + best.score * 0.08),
    reasoning: `${best.reasoning} Matched terms: ${best.hits.join(", ")}.`,
    resolver: "rules"
  };
}

export async function resolveIntent(prompt: string): Promise<IntentResolution> {
  const guardedResolution = resolveGovernanceGuard(prompt);
  if (guardedResolution) return guardedResolution;

  try {
    const llmResolution = await resolveIntentWithLlm(prompt);
    if (llmResolution) return llmResolution;
  } catch (error) {
    console.warn(
      "LLM intent resolver failed; falling back to rules:",
      error instanceof Error ? error.message : error
    );
  }

  return resolveIntentWithRules(prompt);
}
