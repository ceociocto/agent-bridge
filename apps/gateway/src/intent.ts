import { capabilityIds, type CapabilityId, type IntentResolution, type IntentRoutingStep } from "@agent-bridge/shared";
import { z } from "zod";
import { resolveIntentWithLlm } from "./llmIntentResolver.js";
import { createPiiGuardProvider } from "./piiGuard.js";
import { buildRouteDocuments } from "./routeCatalog.js";
import { LocalBm25RouteStore } from "./routeBm25Store.js";
import { getSemanticThresholds, routeIntentSemantically } from "./semanticIntentRouter.js";

const availableCapabilities = [...capabilityIds];
const piiGuardProvider = createPiiGuardProvider();
const bm25RouteStore = new LocalBm25RouteStore(buildRouteDocuments());

const IntentFrameSchema = z.object({
  domain: z.enum(["housing_fund", "pension", "isa", "sipp", "workplace_pension", "adviser", "unknown"]),
  goal: z.enum([
    "withdraw_funds",
    "check_eligibility",
    "retirement_planning",
    "account_composition",
    "contribution_guidance",
    "adviser_review",
    "isa_review",
    "drawdown_review",
    "cancel_or_decline",
    "general_question",
    "unknown"
  ]),
  polarity: z.enum(["positive", "negative", "uncertain"]),
  actionability: z.enum(["transaction_intent", "exploration", "question", "none"]),
  confidence: z.number().min(0).max(1)
});

type IntentFrame = z.infer<typeof IntentFrameSchema>;

const RoutingDecisionSchema = z.object({
  status: z.enum(["resolved", "needs_clarification", "unsupported", "denied"]),
  intent: z.string(),
  capabilityId: z.enum(capabilityIds).optional(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  resolver: z.enum(["llm", "rules", "semantic", "hybrid", "intent_frame", "fallback"])
}).superRefine((decision, ctx) => {
  if (decision.status === "resolved" && !decision.capabilityId) {
    ctx.addIssue({ code: "custom", message: "resolved routing decisions require a capabilityId" });
  }
});

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
  },
  {
    capabilityId: "retirement_pension_task_orchestration",
    intent: "养老金和公积金任务编排",
    keywords: ["养老金", "公积金", "住房公积金", "缺钱", "手头紧", "提取", "取", "取钱", "提取公积金", "取一部分", "退休", "领取", "什么时候退休", "账户构成", "比例"]
  }
];

const broadFinancialTerms = ["pension", "retirement", "invest", "fund", "portfolio", "client", "money", "养老金", "公积金", "退休"];
const maxIntentSpans = Number(process.env.INTENT_SPAN_MAX ?? 8);
const minSpanLength = 12;

const knownOutOfDomainIntents = [
  {
    intent: "general weather information",
    pattern: /(?:天气|气温|温度|下雨|降雨|天气预报|weather|temperature|forecast)/iu,
    reasoning:
      "Recognized this as a general weather request. Weather is outside the published Fidelity UK capability catalog, so no customer or financial APIs were invoked."
  },
  {
    intent: "travel booking",
    pattern: /(?:航班|机票|酒店|旅行|flight|hotel|travel booking)/iu,
    reasoning:
      "Recognized this as a travel request. Travel booking is outside the published Fidelity UK capability catalog, so no customer or financial APIs were invoked."
  }
] as const;

type SpanRoute = {
  span: string;
  capabilityId: CapabilityId;
  intent: string;
  score: number;
  margin: number;
  matchedTerms: string[];
};

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

function hasPensionFundTerm(prompt: string) {
  return /(?:公积金|住房公积金|养老金)/iu.test(prompt);
}

function hasPensionAccessAction(prompt: string) {
  return /(?:提取|取|取钱|取出来|取一部分|拿出来|还房贷|cash access|withdraw)/iu.test(prompt);
}

function hasPensionAccessNegation(prompt: string) {
  return /(?:不要|不想|不用|别|无需|暂不|先不|不要帮我|别帮我|取消)\s*(?:帮我)?\s*(?:提取|取钱|取出来|取一部分|拿出来|取)?\s*(?:一些|一下|部分)?\s*(?:公积金|住房公积金|养老金)?/iu.test(prompt);
}

function hasNegationCancellation(prompt: string) {
  return /(?:不是|并非)\s*(?:不要|不想|不用|别|无需|暂不|先不|取消)/iu.test(prompt);
}

function hasBroadFinancialSignal(prompt: string) {
  const lower = prompt.toLowerCase();
  return broadFinancialTerms.some((word) => lower.includes(word));
}

function extractIntentFrame(prompt: string): IntentFrame {
  const lower = prompt.toLowerCase();
  const negative = hasPensionAccessNegation(prompt) && !hasNegationCancellation(prompt);
  const domain = /(?:公积金|住房公积金)/iu.test(prompt)
    ? "housing_fund"
    : /(?:养老金|退休|领取养老金)/iu.test(prompt)
      ? "pension"
      : /\bisa\b|stocks and shares/i.test(prompt)
        ? "isa"
        : /\bsipp\b|drawdown|mpaa/i.test(prompt)
          ? "sipp"
          : /workplace|employer match|salary sacrifice|contribution rate/i.test(prompt)
            ? "workplace_pension"
            : /adviser|advisor|model portfolio|suitability|review pack/i.test(prompt)
              ? "adviser"
              : "unknown";

  const goal = negative
    ? "cancel_or_decline"
    : hasPensionAccessAction(prompt) && (domain === "housing_fund" || domain === "pension")
      ? "withdraw_funds"
      : /(?:什么时候退休|怎样领取|准备退休|retirement planning)/iu.test(prompt)
        ? "retirement_planning"
        : /(?:比例|组成|构成|分布|配置|composition|allocation)/iu.test(prompt)
          ? "account_composition"
          : /\bisa\b|allowance|cash drag/i.test(prompt)
            ? "isa_review"
            : /\bsipp\b|drawdown|mpaa/i.test(prompt)
              ? "drawdown_review"
              : /workplace|employer match|salary sacrifice|contribution/i.test(prompt)
                ? "contribution_guidance"
                : /adviser|advisor|model portfolio|suitability|review pack/i.test(prompt)
                  ? "adviser_review"
                  : domain !== "unknown"
                    ? "general_question"
                    : "unknown";

  const actionability = negative
    ? "none"
    : goal === "unknown"
      ? "none"
      : /(?:能不能|看看|了解|检查|review|check|can i|should i)/iu.test(lower)
        ? "exploration"
        : goal === "general_question"
          ? "question"
          : "transaction_intent";

  return IntentFrameSchema.parse({
    domain,
    goal,
    polarity: negative ? "negative" : domain === "unknown" && goal === "unknown" ? "uncertain" : "positive",
    actionability,
    confidence: domain === "unknown" && goal === "unknown" ? 0.2 : negative ? 0.9 : 0.72
  });
}

function resolvePensionNoActionGuard(prompt: string): IntentResolution | null {
  if (!hasPensionFundTerm(prompt) || !hasPensionAccessNegation(prompt) || hasNegationCancellation(prompt)) {
    return null;
  }

  return {
    status: "unsupported",
    intent: "no actionable pension or housing fund request",
    confidence: 0.9,
    reasoning:
      "The request mentions pension/housing fund access but is explicitly negated, so the gateway did not start a withdrawal workflow.",
    resolver: "rules",
    availableCapabilities
  };
}

function resolvePensionAmbiguityGuard(prompt: string): IntentResolution | null {
  if (!hasPensionFundTerm(prompt) || hasPensionAccessAction(prompt)) return null;
  if (/(?:退休|领取|什么时候退休|比例|组成|构成|分布|配置)/iu.test(prompt)) return null;

  return {
    status: "needs_clarification",
    intent: "ambiguous pension or housing fund request",
    confidence: 0.48,
    reasoning:
      "The request mentions pension/housing funds but does not state whether the user wants withdrawal, account composition, or retirement planning.",
    resolver: "rules",
    questions: ["你是想提取公积金、查看账户构成，还是咨询退休/领取方案？"],
    availableCapabilities
  };
}

function frameTrace(frame: IntentFrame): IntentRoutingStep {
  return {
    layer: "intent_frame",
    status: "passed",
    detail: `Extracted domain=${frame.domain}, goal=${frame.goal}, polarity=${frame.polarity}, actionability=${frame.actionability}.`,
    confidence: frame.confidence
  };
}

function resolveFrameGuard(prompt: string, frame: IntentFrame): IntentResolution | null {
  if (frame.polarity === "negative" || frame.actionability === "none" && frame.goal === "cancel_or_decline") {
    return {
      status: "unsupported",
      intent: "no actionable financial services request",
      confidence: frame.confidence,
      reasoning:
        "The latest request is explicitly negative or a cancellation, so the gateway did not start a business workflow.",
      resolver: "intent_frame",
      availableCapabilities
    };
  }

  if (frame.domain === "unknown" && frame.actionability === "none" && frame.goal === "unknown") {
    if (hasBroadFinancialSignal(prompt)) {
      return {
        status: "needs_clarification",
        intent: "ambiguous financial services request",
        confidence: Math.max(0.42, frame.confidence),
        reasoning: "The latest request is broadly financial but does not clearly identify one published capability.",
        resolver: "intent_frame",
        questions: [
          "Is this about ISA investing, SIPP drawdown, workplace pension contributions, or an adviser portfolio review?"
        ],
        availableCapabilities
      };
    }

    return {
      status: "unsupported",
      intent: "unclassified request",
      confidence: frame.confidence,
      reasoning:
        "The latest request does not contain enough domain or action evidence to select a governed financial capability.",
      resolver: "intent_frame",
      availableCapabilities
    };
  }

  if ((frame.domain === "housing_fund" || frame.domain === "pension") && frame.goal === "general_question") {
    return {
      status: "needs_clarification",
      intent: "ambiguous pension or housing fund request",
      confidence: frame.confidence,
      reasoning:
        "The latest request mentions pension/housing funds but does not state whether the user wants withdrawal, account composition, or retirement planning.",
      resolver: "intent_frame",
      questions: ["你是想提取公积金、查看账户构成，还是咨询退休/领取方案？"],
      availableCapabilities
    };
  }

  return null;
}

function goalCapabilityBoost(frame: IntentFrame, capabilityId: CapabilityId) {
  if (capabilityId === "retirement_pension_task_orchestration") {
    return ["housing_fund", "pension"].includes(frame.domain) ? 0.18 : 0;
  }
  if (capabilityId === "personal_investing_isa_allowance_review") return frame.domain === "isa" ? 0.16 : 0;
  if (capabilityId === "sipp_drawdown_pathway_review") return frame.domain === "sipp" ? 0.16 : 0;
  if (capabilityId === "workplace_pension_contribution_guidance") return frame.domain === "workplace_pension" ? 0.16 : 0;
  if (capabilityId === "adviser_platform_model_portfolio_review") return frame.domain === "adviser" ? 0.16 : 0;
  return 0;
}

function resolveHybridRoute(prompt: string, frame: IntentFrame): { resolution: IntentResolution; trace: IntentRoutingStep } | null {
  const topK = getSemanticThresholds().topK;
  const bm25 = bm25RouteStore.search(prompt, { topK });
  const semantic = isSemanticRouterEnabled() ? routeIntentSemantically(prompt) : undefined;
  const semanticByCapability = new Map(semantic?.candidates.map((candidate) => [candidate.capabilityId, candidate]) ?? []);
  const bm25Max = Math.max(1, ...bm25.candidates.map((candidate) => candidate.score));
  const candidateIds = [
    ...new Set([
      ...bm25.candidates.map((candidate) => candidate.capabilityId),
      ...(semantic?.candidates.map((candidate) => candidate.capabilityId) ?? [])
    ])
  ];
  const ranked = candidateIds
    .map((capabilityId) => {
      const bm25Candidate = bm25.candidates.find((candidate) => candidate.capabilityId === capabilityId);
      const semanticCandidate = semanticByCapability.get(capabilityId);
      const bm25Score = (bm25Candidate?.score ?? 0) / bm25Max;
      const semanticScore = semanticCandidate?.score ?? 0;
      const boost = goalCapabilityBoost(frame, capabilityId);
      return {
        capabilityId,
        intent: bm25Candidate?.intent ?? semanticCandidate?.intent ?? capabilityId,
        score: bm25Score * 0.46 + semanticScore * 0.36 + boost,
        matchedTerms: [...new Set([...(bm25Candidate?.matchedTerms ?? []), ...(semanticCandidate?.matchedTerms ?? [])])].slice(0, 8),
        bm25Score,
        semanticScore,
        boost
      };
    })
    .sort((left, right) => right.score - left.score);

  const top = ranked[0];
  const runnerUp = ranked[1];
  const margin = (top?.score ?? 0) - (runnerUp?.score ?? 0);
  const trace: IntentRoutingStep = {
    layer: "hybrid_retriever",
    status: "passed",
    detail: `Combined BM25 and semantic candidates; top score ${(top?.score ?? 0).toFixed(2)}, margin ${margin.toFixed(2)}.`,
    capabilityId: top?.capabilityId,
    confidence: top?.score,
    candidates: ranked.slice(0, topK).map((candidate) => ({
      capabilityId: candidate.capabilityId,
      score: Number(candidate.score.toFixed(3)),
      matchedTerms: [
        ...candidate.matchedTerms,
        `bm25:${candidate.bm25Score.toFixed(2)}`,
        `semantic:${candidate.semanticScore.toFixed(2)}`,
        `frame:${candidate.boost.toFixed(2)}`
      ]
    }))
  };

  if (!top || top.score < 0.22) return { resolution: resolveIntentWithConservativeFallback([]), trace: { ...trace, status: "unsupported" } };
  if (runnerUp && margin < 0.04 && top.score < 0.55) {
    const decision = RoutingDecisionSchema.parse({
      status: "needs_clarification",
      intent: "ambiguous financial services request",
      confidence: Number(top.score.toFixed(3)),
      reasoning: "Hybrid retrieval found close capability candidates and requires user confirmation before invoking a workflow.",
      resolver: "hybrid"
    });
    return {
      resolution: {
        ...decision,
        questions: [`Which request should I handle first: ${top.intent} or ${runnerUp.intent}?`],
        availableCapabilities: ranked.slice(0, 3).map((candidate) => candidate.capabilityId)
      },
      trace: { ...trace, status: "needs_clarification" }
    };
  }

  const decision = RoutingDecisionSchema.parse({
    status: "resolved",
    intent: top.intent,
    capabilityId: top.capabilityId,
    confidence: Math.min(0.96, Number(top.score.toFixed(3))),
    reasoning: "Hybrid retriever selected a capability using IntentFrame context plus BM25 and semantic evidence.",
    resolver: "hybrid"
  });
  return {
    resolution: decision,
    trace: { ...trace, status: "resolved" }
  };
}

function normalizePromptForRouting(prompt: string) {
  return prompt
    .replace(/[£$€]\s?\d+(?:,\d{3})*(?:\.\d+)?/g, " amount ")
    .replace(/\b\d+(?:,\d{3})*(?:\.\d+)?\s?(?:%|percent)\b/gi, " percentage ")
    .replace(/\b\d{4,}\b/g, " number ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitPromptIntoIntentSpans(prompt: string) {
  const normalized = normalizePromptForRouting(prompt);
  const spans = normalized
    .split(
      /(?:\n+|[.;!?]+|\s+-\s+|\s+also\s+|\s+separately\s+|\s+at the same time\s+|\s+as well as\s+|\s+plus\s+)/i
    )
    .map((span) => span.trim())
    .filter((span) => span.length >= minSpanLength)
    .slice(0, maxIntentSpans);

  if (spans.length <= 1 && normalized.length >= 220) {
    return normalized
      .split(/,\s+(?=(?:check|review|show|assess|compare|prepare|create|help|can|should|is|am)\b)/i)
      .map((span) => span.trim())
      .filter((span) => span.length >= minSpanLength)
      .slice(0, maxIntentSpans);
  }

  return spans.length ? spans : [normalized];
}

function buildPreprocessorTrace(prompt: string, spans: string[]): IntentRoutingStep {
  return {
    layer: "prompt_preprocessor",
    status: "passed",
    detail: `Normalized ${prompt.length} input characters into ${spans.length} routing span${
      spans.length === 1 ? "" : "s"
    }.`
  };
}

function detectMultiIntent(spans: string[]): { resolution: IntentResolution; trace: IntentRoutingStep } | null {
  if (spans.length < 2 || !isSemanticRouterEnabled()) return null;

  const thresholds = getSemanticThresholds();
  const confidentRoutes = spans
    .map((span): SpanRoute | null => {
      const semantic = routeIntentSemantically(span);
      const top = semantic.top;
      if (!top || semantic.topScore < thresholds.resolve || semantic.margin < Math.max(0.02, thresholds.margin * 0.6)) {
        return null;
      }

      return {
        span,
        capabilityId: top.capabilityId,
        intent: top.intent,
        score: semantic.topScore,
        margin: semantic.margin,
        matchedTerms: top.matchedTerms
      };
    })
    .filter((route): route is SpanRoute => Boolean(route));

  const distinctCapabilityIds = [...new Set(confidentRoutes.map((route) => route.capabilityId))];
  if (distinctCapabilityIds.length < 2) return null;

  const topRoutesByCapability = distinctCapabilityIds
    .map((capabilityId) =>
      confidentRoutes
        .filter((route) => route.capabilityId === capabilityId)
        .sort((left, right) => right.score - left.score)[0]
    )
    .sort((left, right) => right.score - left.score);

  const available = topRoutesByCapability.map((route) => route.capabilityId);
  return {
    resolution: {
      status: "needs_clarification",
      intent: "multi-intent financial services request",
      confidence: Number(topRoutesByCapability[0].score.toFixed(3)),
      reasoning:
        "The request contains multiple capability-level intents; the gateway will not auto-compose regulated workflows without confirmation.",
      resolver: "semantic",
      questions: [
        `Which request should I handle first: ${topRoutesByCapability
          .map((route) => route.intent)
          .slice(0, 3)
          .join(", ")}?`
      ],
      availableCapabilities: available
    },
    trace: {
      layer: "multi_intent_aggregator",
      status: "needs_clarification",
      detail: `Detected ${distinctCapabilityIds.length} distinct capability intents across ${spans.length} routing spans.`,
      confidence: Number(topRoutesByCapability[0].score.toFixed(3)),
      candidates: topRoutesByCapability.map((route) => ({
        capabilityId: route.capabilityId,
        score: Number(route.score.toFixed(3)),
        matchedTerms: [route.span.slice(0, 80), ...route.matchedTerms].slice(0, 8)
      }))
    }
  };
}

function resolveRulesGuard(prompt: string): IntentResolution | null {
  const lower = prompt.toLowerCase();
  const scored = scoreRules(prompt);
  const top = scored[0];
  const runnerUp = scored[1];
  const matchedCapabilities = scored.filter((match) => match.score > 0);
  const hasExplicitMultiIntentConnector =
    /(?:also|separately|at the same time|as well as|plus|另外|同时|分别|顺便)/iu.test(prompt);

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

  if (hasExplicitMultiIntentConnector && matchedCapabilities.length >= 2) {
    return {
      status: "needs_clarification",
      intent: "multi-intent financial services request",
      confidence: 0.56,
      reasoning: `The request contains signals for multiple capabilities (${matchedCapabilities
        .slice(0, 3)
        .map((match) => match.intent)
        .join(", ")}); the gateway will not auto-compose regulated workflows without confirmation.`,
      resolver: "rules",
      questions: [
        `Which request should I handle first: ${matchedCapabilities
          .slice(0, 3)
          .map((match) => match.intent)
          .join(", ")}?`
      ],
      availableCapabilities: matchedCapabilities.map((match) => match.capabilityId)
    };
  }

  if (!top?.score && hasBroadFinancialSignal(prompt)) {
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

function resolveKnownOutOfDomainIntent(prompt: string): IntentResolution | null {
  const match = knownOutOfDomainIntents.find((candidate) => candidate.pattern.test(prompt));
  if (!match) return null;

  return {
    status: "unsupported",
    intent: match.intent,
    confidence: 0.99,
    reasoning: match.reasoning,
    resolver: "rules",
    availableCapabilities
  };
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

  const routingPrompt = normalizePromptForRouting(prompt);
  const intentSpans = splitPromptIntoIntentSpans(prompt);
  routingTrace.push(buildPreprocessorTrace(prompt, intentSpans));

  const outOfDomain = resolveKnownOutOfDomainIntent(routingPrompt);
  if (outOfDomain) {
    return withTrace(outOfDomain, [
      ...routingTrace,
      {
        layer: "rules_guard",
        status: "unsupported",
        detail: outOfDomain.reasoning,
        confidence: outOfDomain.confidence
      }
    ]);
  }

  const intentFrame = extractIntentFrame(routingPrompt);
  routingTrace.push(frameTrace(intentFrame));
  const frameGuard = resolveFrameGuard(routingPrompt, intentFrame);
  if (frameGuard) {
    return withTrace(frameGuard, [
      ...routingTrace,
      {
        layer: "intent_frame_guard",
        status: frameGuard.status,
        detail: frameGuard.reasoning,
        confidence: frameGuard.confidence
      }
    ]);
  }

  const pensionNoAction = resolvePensionNoActionGuard(routingPrompt);
  if (pensionNoAction) {
    return withTrace(pensionNoAction, [
      ...routingTrace,
      {
        layer: "rules_guard",
        status: "unsupported",
        detail: pensionNoAction.reasoning,
        confidence: pensionNoAction.confidence
      }
    ]);
  }

  const pensionAmbiguity = resolvePensionAmbiguityGuard(routingPrompt);
  if (pensionAmbiguity) {
    return withTrace(pensionAmbiguity, [
      ...routingTrace,
      {
        layer: "rules_guard",
        status: "needs_clarification",
        detail: pensionAmbiguity.reasoning,
        confidence: pensionAmbiguity.confidence
      }
    ]);
  }

  const ruleGuard = resolveRulesGuard(routingPrompt);
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
  routingTrace.push(buildRuleTrace(routingPrompt));

  const multiIntent = detectMultiIntent(intentSpans);
  if (multiIntent) {
    return withTrace(multiIntent.resolution, [...routingTrace, multiIntent.trace]);
  }
  if (intentSpans.length > 1 && isSemanticRouterEnabled()) {
    routingTrace.push({
      layer: "multi_intent_aggregator",
      status: "passed",
      detail: `Checked ${intentSpans.length} routing spans; no distinct high-confidence capability split was found.`
    });
  }

  const hybridRoute = resolveHybridRoute(routingPrompt, intentFrame);
  if (hybridRoute) {
    if (hybridRoute.resolution.status === "unsupported") {
      return resolveIntentWithConservativeFallback([...routingTrace, hybridRoute.trace]);
    }
    return withTrace(hybridRoute.resolution, [...routingTrace, hybridRoute.trace]);
  }

  if (!isSemanticRouterEnabled()) {
    routingTrace.push(semanticTrace());
  } else {
    const semantic = routeIntentSemantically(routingPrompt);
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
