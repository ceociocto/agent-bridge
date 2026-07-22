import type { CapabilityId } from "@agent-bridge/shared";
import type { RouteDocument } from "./routeCatalog.js";

export type RouteSearchCandidate = {
  capabilityId: CapabilityId;
  intent: string;
  score: number;
  matchedTerms: string[];
  scoreComponents: {
    positiveCosine: number;
    keywordCoverage: number;
    domainCoverage: number;
    negativePenalty: number;
  };
};

export type RouteSearchResult = {
  candidates: RouteSearchCandidate[];
  top?: RouteSearchCandidate;
  runnerUp?: RouteSearchCandidate;
  topScore: number;
  margin: number;
};

export type EmbeddingProvider = {
  embed(text: string): Promise<number[]>;
  embedBatch?(texts: string[]): Promise<number[][]>;
};

export type RouteVectorStore = {
  search(prompt: string, options: { topK: number }): RouteSearchResult;
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

function uniqueTokens(texts: string[]) {
  return new Set(texts.flatMap((text) => tokenize(text)));
}

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

export class LocalRouteVectorStore implements RouteVectorStore {
  private readonly entries: Array<{
    document: RouteDocument;
    positiveTokens: Set<string>;
    negativeTokens: Set<string>;
    keywordTokens: Set<string>;
    domainTokens: Set<string>;
    positiveVector: Map<string, number>;
    negativeVector: Map<string, number>;
  }>;

  constructor(documents: RouteDocument[]) {
    this.entries = documents.map((document) => {
      const positiveTokens = tokenize(document.positiveText);
      const negativeTokens = tokenize(document.negativeText);
      return {
        document,
        positiveTokens: new Set(positiveTokens),
        negativeTokens: new Set(negativeTokens),
        keywordTokens: uniqueTokens(document.metadata.keywords),
        domainTokens: uniqueTokens(document.metadata.domains),
        positiveVector: termFrequency(positiveTokens),
        negativeVector: termFrequency(negativeTokens)
      };
    });
  }

  search(prompt: string, options: { topK: number }): RouteSearchResult {
    const promptTokens = tokenize(prompt);
    const promptVector = termFrequency(promptTokens);
    const promptTokenSet = new Set(promptTokens);

    const candidates = this.entries
      .map(({ document, positiveTokens, negativeTokens, keywordTokens, domainTokens, positiveVector, negativeVector }) => {
        const matchedTerms = [...promptTokenSet].filter((token) => positiveTokens.has(token)).slice(0, 8);
        const negativeMatchedTerms = [...promptTokenSet].filter((token) => negativeTokens.has(token)).slice(0, 8);
        const positiveScore = cosineSimilarity(promptVector, positiveVector);
        const negativeScore = cosineSimilarity(promptVector, negativeVector);
        const keywordMatches = [...promptTokenSet].filter((token) => keywordTokens.has(token));
        const domainMatches = [...promptTokenSet].filter((token) => domainTokens.has(token));
        const keywordCoverage = keywordTokens.size ? keywordMatches.length / keywordTokens.size : 0;
        const domainCoverage = domainTokens.size ? domainMatches.length / domainTokens.size : 0;
        const negativePenalty = negativeScore * 0.35;
        const score = Math.max(
          0,
          positiveScore * 0.55 + Math.min(keywordCoverage, 0.5) * 0.7 + Math.min(domainCoverage, 0.5) * 0.3 - negativePenalty
        );

        return {
          capabilityId: document.capabilityId,
          intent: document.intent,
          score,
          matchedTerms: [
            ...new Set([
              ...matchedTerms,
              ...keywordMatches.map((term) => `kw:${term}`),
              ...domainMatches.map((term) => `domain:${term}`),
              ...negativeMatchedTerms.map((term) => `not:${term}`)
            ])
          ].slice(0, 8),
          scoreComponents: {
            positiveCosine: positiveScore,
            keywordCoverage,
            domainCoverage,
            negativePenalty
          }
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, options.topK));

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
}
