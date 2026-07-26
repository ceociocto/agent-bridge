import type { CapabilityId } from "@agent-bridge/shared";
import type { RouteDocument } from "./routeCatalog.js";

export type Bm25RouteCandidate = {
  capabilityId: CapabilityId;
  intent: string;
  score: number;
  matchedTerms: string[];
};

export type Bm25RouteResult = {
  candidates: Bm25RouteCandidate[];
  top?: Bm25RouteCandidate;
  runnerUp?: Bm25RouteCandidate;
  topScore: number;
  margin: number;
};

const latinStopWords = new Set([
  "and",
  "are",
  "can",
  "for",
  "from",
  "how",
  "the",
  "this",
  "what",
  "with",
  "your"
]);

function tokenize(text: string) {
  const normalized = text.toLowerCase();
  const latin = normalized
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !latinStopWords.has(token) && !/^\d+$/.test(token));
  const cjk = [...normalized.matchAll(/[\p{Script=Han}]{1,12}/gu)]
    .flatMap((match) => {
      const segment = match[0];
      const tokens = [segment];
      for (let size = 2; size <= Math.min(4, segment.length); size += 1) {
        for (let index = 0; index <= segment.length - size; index += 1) {
          tokens.push(segment.slice(index, index + size));
        }
      }
      return tokens;
    });
  return [...latin, ...cjk];
}

function termCounts(tokens: string[]) {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

export class LocalBm25RouteStore {
  private readonly avgDocLength: number;
  private readonly documentFrequency = new Map<string, number>();
  private readonly entries: Array<{
    document: RouteDocument;
    counts: Map<string, number>;
    length: number;
  }>;

  constructor(documents: RouteDocument[]) {
    this.entries = documents.map((document) => {
      const counts = termCounts(tokenize(`${document.intent} ${document.positiveText}`));
      for (const token of counts.keys()) {
        this.documentFrequency.set(token, (this.documentFrequency.get(token) ?? 0) + 1);
      }
      return {
        document,
        counts,
        length: [...counts.values()].reduce((sum, count) => sum + count, 0)
      };
    });
    this.avgDocLength = this.entries.reduce((sum, entry) => sum + entry.length, 0) / Math.max(1, this.entries.length);
  }

  search(prompt: string, options: { topK: number }): Bm25RouteResult {
    const queryTokens = [...new Set(tokenize(prompt))];
    const totalDocs = this.entries.length;
    const k1 = 1.2;
    const b = 0.75;

    const candidates = this.entries
      .map(({ document, counts, length }) => {
        let score = 0;
        const matchedTerms: string[] = [];
        for (const token of queryTokens) {
          const termFrequency = counts.get(token) ?? 0;
          if (!termFrequency) continue;
          matchedTerms.push(token);
          const df = this.documentFrequency.get(token) ?? 0;
          const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));
          const denominator = termFrequency + k1 * (1 - b + b * (length / this.avgDocLength));
          score += idf * ((termFrequency * (k1 + 1)) / denominator);
        }
        return {
          capabilityId: document.capabilityId,
          intent: document.intent,
          score,
          matchedTerms: matchedTerms.slice(0, 8)
        };
      })
      .sort((left, right) => right.score - left.score)
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
