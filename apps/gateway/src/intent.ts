import type { CapabilityId, IntentResolution } from "@agent-bridge/shared";

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

export function resolveIntent(prompt: string): IntentResolution {
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
      intent: "retirement planning assessment",
      capabilityId: "retirement_readiness_assessment",
      confidence: 0.52,
      reasoning: "No strong keyword match was found, so the gateway selected the safest read-only planning capability."
    };
  }

  return {
    intent: best.capabilityId.replaceAll("_", " "),
    capabilityId: best.capabilityId,
    confidence: Math.min(0.95, 0.62 + best.score * 0.08),
    reasoning: `${best.reasoning} Matched terms: ${best.hits.join(", ")}.`
  };
}
