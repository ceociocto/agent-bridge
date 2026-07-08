import { capabilityIds, type IntentResolution } from "@agent-bridge/shared";
import { resolveIntentWithLlm } from "./llmIntentResolver.js";

const availableCapabilities = [...capabilityIds];

function resolveIntentWithConservativeFallback(): IntentResolution {
  return {
    status: "unsupported",
    intent: "unclassified request",
    confidence: 0,
    reasoning:
      "The gateway could not confidently map this request to a published capability, so it did not invoke downstream APIs.",
    resolver: "fallback",
    availableCapabilities
  };
}

function policyDeny(prompt: string): IntentResolution | null {
  const lower = prompt.toLowerCase();
  const sensitivePatterns = [
    "national insurance",
    "ni number",
    "full account number",
    "sort code",
    "passport",
    "password",
    "credential",
    "tax identifier",
    "raw pii"
  ];

  if (!sensitivePatterns.some((pattern) => lower.includes(pattern))) return null;

  return {
    status: "denied",
    intent: "sensitive identifier disclosure",
    confidence: 0.98,
    reasoning: "The request asks for regulated identifiers beyond the data-minimized capability contract.",
    resolver: "rules",
    policyDecision: {
      name: "data_minimization",
      status: "requires_confirmation",
      detail: "The gateway can provide redacted account context or a review summary, not raw regulated identifiers."
    }
  };
}

function resolveIntentWithRules(prompt: string): IntentResolution | null {
  const denied = policyDeny(prompt);
  if (denied) return denied;

  const lower = prompt.toLowerCase();
  const matches = [
    {
      capabilityId: "personal_investing_isa_allowance_review" as const,
      intent: "personal investing isa allowance review",
      keywords: ["isa", "stocks and shares", "investment account", "tax wrapper", "cash drag", "allowance"]
    },
    {
      capabilityId: "sipp_drawdown_pathway_review" as const,
      intent: "sipp drawdown pathway review",
      keywords: ["sipp", "drawdown", "investment pathway", "pathways", "mpaa", "taxable pension", "take income"]
    },
    {
      capabilityId: "workplace_pension_contribution_guidance" as const,
      intent: "workplace pension contribution guidance",
      keywords: ["workplace", "employer match", "salary sacrifice", "pension contribution", "contribution rate"]
    },
    {
      capabilityId: "adviser_platform_model_portfolio_review" as const,
      intent: "adviser platform model portfolio review",
      keywords: ["adviser", "advisor", "model portfolio", "suitability", "drift", "review pack", "wealthbuilder"]
    }
  ];

  const scored = matches
    .map((match) => ({
      ...match,
      score: match.keywords.filter((keyword) => lower.includes(keyword)).length
    }))
    .sort((a, b) => b.score - a.score);

  if (scored[0]?.score > 0) {
    return {
      status: "resolved",
      intent: scored[0].intent,
      capabilityId: scored[0].capabilityId,
      confidence: Math.min(0.94, 0.66 + scored[0].score * 0.09),
      reasoning: "Rule baseline matched capability-specific UK financial service terms.",
      resolver: "rules"
    };
  }

  if (["pension", "retirement", "invest", "fund", "portfolio", "client", "money"].some((word) => lower.includes(word))) {
    return {
      status: "needs_clarification",
      intent: "ambiguous financial services request",
      confidence: 0.42,
      reasoning: "The request is financial but does not clearly identify one published capability.",
      resolver: "rules",
      questions: [
        "Is this about ISA investing, SIPP drawdown, workplace pension contributions, or an adviser portfolio review?"
      ],
      availableCapabilities
    };
  }

  return null;
}

export async function resolveIntent(prompt: string, options: { useLlm?: boolean } = {}): Promise<IntentResolution> {
  try {
    if (options.useLlm !== false) {
      const llmResolution = await resolveIntentWithLlm(prompt);
      if (llmResolution) return llmResolution;
    }
  } catch (error) {
    console.warn(
      "LLM intent resolver failed; using conservative unsupported fallback:",
      error instanceof Error ? error.message : error
    );
  }

  const ruleResolution = resolveIntentWithRules(prompt);
  if (ruleResolution) return ruleResolution;

  return resolveIntentWithConservativeFallback();
}
