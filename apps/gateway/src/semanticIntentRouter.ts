import type { CapabilityId } from "@agent-bridge/shared";
import { capabilities } from "./catalog.js";

export type SemanticCandidate = {
  capabilityId: CapabilityId;
  intent: string;
  score: number;
  matchedTerms: string[];
};

export type SemanticRouterResult = {
  candidates: SemanticCandidate[];
  top?: SemanticCandidate;
  runnerUp?: SemanticCandidate;
  topScore: number;
  margin: number;
};

const stopWords = new Set([
  "a",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "for",
  "from",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "please",
  "should",
  "show",
  "the",
  "this",
  "to",
  "what",
  "when",
  "with",
  "without",
  "year",
  "your"
]);

function normalizeToken(token: string) {
  return token
    .toLowerCase()
    .replace(/'s$/, "")
    .replace(/[^a-z0-9]/g, "")
    .replace(/ies$/, "y")
    .replace(/s$/, "");
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !stopWords.has(token) && !/^\d+$/.test(token))
    .map(normalizeToken)
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

function termFrequency(tokens: string[]) {
  const vector = new Map<string, number>();
  for (const token of tokens) {
    vector.set(token, (vector.get(token) ?? 0) + 1);
  }
  return vector;
}

function cosineSimilarity(left: Map<string, number>, right: Map<string, number>) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (const value of left.values()) leftNorm += value * value;
  for (const value of right.values()) rightNorm += value * value;
  for (const [token, value] of left) dot += value * (right.get(token) ?? 0);

  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function capabilityText(capability: (typeof capabilities)[number]) {
  return [
    capability.id.replaceAll("_", " "),
    capability.name,
    capability.description,
    capability.businessOutcome,
    capability.requiredApis.join(" "),
    Object.keys(capability.inputSchema).join(" "),
    capability.examplePrompts.join(" ")
  ].join(" ");
}

const capabilityVectors = capabilities.map((capability) => {
  const tokens = tokenize(capabilityText(capability));
  return {
    capability,
    tokens: new Set(tokens),
    vector: termFrequency(tokens)
  };
});

export function getSemanticThresholds() {
  return {
    resolve: Number(process.env.SEMANTIC_ROUTER_RESOLVE_THRESHOLD ?? 0.18),
    unsupported: Number(process.env.SEMANTIC_ROUTER_UNSUPPORTED_THRESHOLD ?? 0.08),
    margin: Number(process.env.SEMANTIC_ROUTER_MARGIN_THRESHOLD ?? 0.05),
    topK: Number(process.env.SEMANTIC_ROUTER_TOP_K ?? 3)
  };
}

export function routeIntentSemantically(prompt: string): SemanticRouterResult {
  const promptTokens = tokenize(prompt);
  const promptVector = termFrequency(promptTokens);
  const promptTokenSet = new Set(promptTokens);
  const { topK } = getSemanticThresholds();

  const candidates = capabilityVectors
    .map(({ capability, tokens, vector }) => {
      const matchedTerms = [...promptTokenSet].filter((token) => tokens.has(token)).slice(0, 8);
      return {
        capabilityId: capability.id,
        intent: capability.name.toLowerCase(),
        score: cosineSimilarity(promptVector, vector),
        matchedTerms
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, topK));

  const top = candidates[0];
  const runnerUp = candidates[1];
  return {
    candidates,
    top,
    runnerUp,
    topScore: top?.score ?? 0,
    margin: (top?.score ?? 0) - (runnerUp?.score ?? 0)
  };
}
