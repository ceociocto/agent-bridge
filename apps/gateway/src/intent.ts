import { capabilityIds, type CapabilityId, type IntentResolution, type IntentRoutingStep } from "@agent-bridge/shared";
import { resolveIntentWithLlm } from "./llmIntentResolver.js";
import { createPiiGuardProvider } from "./piiGuard.js";
import { getSemanticThresholds, routeIntentSemantically } from "./semanticIntentRouter.js";

const availableCapabilities = [...capabilityIds];
const piiGuardProvider = createPiiGuardProvider();

type RuleMatch = {
  capabilityId: CapabilityId;
  intent: string;
  keywords: string[];
};

const ruleMatches: RuleMatch[] = [
  {
    capabilityId: "personal_investing_isa_allowance_review",
    intent: "personal investing isa allowance review",
    keywords: ["isa", "stocks and shares", "investment account", "tax wrapper", "cash drag", "allowance"]
  },
  {
    capabilityId: "sipp_drawdown_pathway_review",
    intent: "sipp drawdown pathway review",
    keywords: ["sipp", "drawdown", "investment pathway", "pathways", "mpaa", "taxable pension", "take income"]
  },
  {
    capabilityId: "workplace_pension_contribution_guidance",
    intent: "workplace pension contribution guidance",
    keywords: ["workplace", "employer match", "salary sacrifice", "pension contribution", "contribution rate"]
  },
  {
    capabilityId: "adviser_platform_model_portfolio_review",
    intent: "adviser platform model portfolio review",
    keywords: ["adviser", "advisor", "model portfolio", "suitability", "drift", "review pack", "wealthbuilder"]
  }
];

const broadFinancialTerms = ["pension", "retirement", "invest", "fund", "portfolio", "client", "money"];

function withTrace(resolution: IntentResolution, routingTrace: IntentRoutingStep[]): IntentResolution {
  return {
    ...resolution,
    routingTrace
  };
}

function resolveIntentWithConservativeFallback(routingTrace: IntentRoutingStep[]): IntentResolution {
  return withTrace(
    {
      status: "unsupported",
      intent: "unclassified request",
      confidence: 0,
      reasoning:
        "The gateway could not confidently map this request to a published capability, so it did not invoke downstream APIs.",
      resolver: "fallback",
      availableCapabilities
    },
    [
      ...routingTrace,
      {
        layer: "fallback",
        status: "unsupported",
        detail: "No deterministic, semantic, or model-based route reached the invocation threshold."
      }
    ]
  );
}

function scoreRules(prompt: string) {
  const lower = prompt.toLowerCase();
  return ruleMatches
    .map((match) => ({
      ...match,
      score: match.keywords.filter((keyword) => lower.includes(keyword)).length
    }))
    .sort((a, b) => b.score - a.score);
}

function resolveRulesGuard(prompt: string): IntentResolution | null {
  const lower = prompt.toLowerCase();
  const scored = scoreRules(prompt);
  const top = scored[0];
  const runnerUp = scored[1];

  if (top && top.score > 0 && runnerUp && runnerUp.score === top.score) {
    return {
      status: "needs_clarification",
      intent: "ambiguous multi-domain financial services request",
      confidence: 0.5,
      reasoning: `The request matches multiple capabilities (${top.intent}, ${runnerUp.intent}) with equal strength; the gateway will not auto-route to avoid a privilege downgrade.`,
      resolver: "rules",
      questions: [`Is this primarily about ${top.intent} or ${runnerUp.intent}?`],
      availableCapabilities
    };
  }

  if (!top?.score && broadFinancialTerms.some((word) => lower.includes(word))) {
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

function buildRuleTrace(prompt: string): IntentRoutingStep {
  const scored = scoreRules(prompt);
  const matched = scored.filter((match) => match.score > 0);

  if (!matched.length) {
    return {
      layer: "rules_guard",
      status: "passed",
      detail: "No capability-specific keyword tie was found; semantic router will compare the catalog."
    };
  }

  return {
    layer: "rules_guard",
    status: "passed",
    detail: "Keyword baseline found signals but no equal-score regulated-domain tie.",
    candidates: matched.map((match) => ({
      capabilityId: match.capabilityId,
      score: match.score,
      matchedTerms: match.keywords.filter((keyword) => prompt.toLowerCase().includes(keyword))
    }))
  };
}

function semanticTrace(): IntentRoutingStep {
  const semantic = routeIntentSemantically("");
  return {
    layer: "semantic_router",
    status: "skipped",
    detail: `Semantic router is disabled by INTENT_SEMANTIC_ROUTER=off; ${semantic.candidates.length} catalog vectors are available.`
  };
}

function isSemanticRouterEnabled() {
  return process.env.INTENT_SEMANTIC_ROUTER !== "off";
}

export async function resolveIntent(prompt: string, options: { useLlm?: boolean } = {}): Promise<IntentResolution> {
  const routingTrace: IntentRoutingStep[] = [];

  const piiDecision = await piiGuardProvider.analyze(prompt);
  if (piiDecision.status === "denied") {
    return withTrace(
      {
        status: "denied",
        intent: "sensitive identifier disclosure",
        confidence: piiDecision.confidence,
        reasoning: piiDecision.reasoning,
        resolver: "rules",
        policyDecision: piiDecision.policyDecision
      },
      [
        {
          layer: "policy_guard",
          status: "denied",
          detail: `${piiDecision.reasoning} Detected entities: ${
            piiDecision.detectedEntities.length ? piiDecision.detectedEntities.join(", ") : "none"
          }.`,
          confidence: piiDecision.confidence
        }
      ]
    );
  }

  routingTrace.push({
    layer: "policy_guard",
    status: "passed",
    detail: piiDecision.detectedEntities.length
      ? `${piiDecision.reasoning} Observed entities: ${piiDecision.detectedEntities.join(", ")}.`
      : piiDecision.reasoning
  });

  const ruleGuard = resolveRulesGuard(prompt);
  if (ruleGuard) {
    return withTrace(ruleGuard, [
      ...routingTrace,
      {
        layer: "rules_guard",
        status: ruleGuard.status,
        detail: ruleGuard.reasoning,
        confidence: ruleGuard.confidence
      }
    ]);
  }
  routingTrace.push(buildRuleTrace(prompt));

  if (!isSemanticRouterEnabled()) {
    routingTrace.push(semanticTrace());
  } else {
    const semantic = routeIntentSemantically(prompt);
    const thresholds = getSemanticThresholds();
    const semanticStep: IntentRoutingStep = {
      layer: "semantic_router",
      status: "passed",
      detail: `Compared the request with catalog vectors; top score ${semantic.topScore.toFixed(2)}, margin ${semantic.margin.toFixed(2)}.`,
      capabilityId: semantic.top?.capabilityId,
      confidence: semantic.topScore,
      candidates: semantic.candidates.map((candidate) => ({
        capabilityId: candidate.capabilityId,
        score: Number(candidate.score.toFixed(3)),
        matchedTerms: candidate.matchedTerms
      }))
    };
    routingTrace.push(semanticStep);

    const topCandidate = semantic.top;
    const hasConfidentSemanticMatch =
      Boolean(topCandidate) &&
      semantic.topScore >= thresholds.resolve &&
      semantic.margin >= thresholds.margin;
    if (hasConfidentSemanticMatch && topCandidate) {
      semanticStep.status = "resolved";
      semanticStep.detail = `Semantic router selected ${topCandidate.capabilityId} without an LLM call.`;
      return withTrace(
        {
          status: "resolved",
          intent: topCandidate.intent,
          capabilityId: topCandidate.capabilityId,
          confidence: Number(semantic.topScore.toFixed(3)),
          reasoning: "Semantic router found a clear catalog capability match above the local threshold.",
          resolver: "semantic"
        },
        routingTrace
      );
    }

    if (semantic.topScore < thresholds.unsupported) {
      semanticStep.status = "unsupported";
      semanticStep.detail = "Semantic router found no catalog candidate above the unsupported threshold.";
      return resolveIntentWithConservativeFallback(routingTrace);
    }

    semanticStep.status = "escalated";
    semanticStep.detail =
      "Semantic router found a possible but ambiguous catalog match; LLM adjudicator may inspect the top candidates.";

    try {
      if (options.useLlm !== false) {
        const candidateIds = semantic.candidates.map((candidate) => candidate.capabilityId);
        const llmResolution = await resolveIntentWithLlm(prompt, candidateIds);
        if (llmResolution) {
          return withTrace(llmResolution, [
            ...routingTrace,
            {
              layer: "llm_adjudicator",
              status: llmResolution.status,
              detail: `LLM adjudicated ${candidateIds.length} semantic candidates: ${llmResolution.reasoning}`,
              capabilityId: llmResolution.capabilityId,
              confidence: llmResolution.confidence
            }
          ]);
        }
      }

      routingTrace.push({
        layer: "llm_adjudicator",
        status: "skipped",
        detail:
          options.useLlm === false
            ? "LLM adjudicator disabled for this request."
            : "LLM adjudicator is not configured."
      });
    } catch (error) {
      routingTrace.push({
        layer: "llm_adjudicator",
        status: "skipped",
        detail: `LLM adjudicator failed: ${error instanceof Error ? error.message : String(error)}`
      });
      console.warn(
        "LLM intent resolver failed; using conservative fallback:",
        error instanceof Error ? error.message : error
      );
    }

    return withTrace(
      {
        status: "needs_clarification",
        intent: "ambiguous semantic financial services request",
        confidence: Number(semantic.topScore.toFixed(3)),
        reasoning:
          "The semantic router found related capabilities, but the match was not strong enough to invoke a single capability without adjudication.",
        resolver: "semantic",
        questions: [
          `Is this primarily about ${semantic.candidates
            .map((candidate) => candidate.intent)
            .slice(0, 2)
            .join(" or ")}?`
        ],
        availableCapabilities: semantic.candidates.map((candidate) => candidate.capabilityId)
      },
      routingTrace
    );
  }

  try {
    if (options.useLlm !== false) {
      const llmResolution = await resolveIntentWithLlm(prompt);
      if (llmResolution) {
        return withTrace(llmResolution, [
          ...routingTrace,
          {
            layer: "llm_adjudicator",
            status: llmResolution.status,
            detail: `LLM adjudicated the full catalog because semantic routing was disabled: ${llmResolution.reasoning}`,
            capabilityId: llmResolution.capabilityId,
            confidence: llmResolution.confidence
          }
        ]);
      }
    }
  } catch (error) {
    routingTrace.push({
      layer: "llm_adjudicator",
      status: "skipped",
      detail: `LLM adjudicator failed: ${error instanceof Error ? error.message : String(error)}`
    });
    console.warn(
      "LLM intent resolver failed; using conservative fallback:",
      error instanceof Error ? error.message : error
    );
  }

  return resolveIntentWithConservativeFallback(routingTrace);
}
