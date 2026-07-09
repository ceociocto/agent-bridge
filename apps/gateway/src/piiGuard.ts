import type { AuditStep } from "@agent-bridge/shared";

export type PiiGuardDecision = {
  status: "passed" | "denied";
  confidence: number;
  reasoning: string;
  detectedEntities: string[];
  policyDecision?: AuditStep;
};

export type PiiGuardProvider = {
  analyze(prompt: string): Promise<PiiGuardDecision>;
};

type PresidioEntity = {
  entity_type?: string;
  score?: number;
};

const localSensitivePatterns = [
  { pattern: "national insurance", entity: "UK_NATIONAL_INSURANCE_NUMBER" },
  { pattern: "ni number", entity: "UK_NATIONAL_INSURANCE_NUMBER" },
  { pattern: "full account number", entity: "ACCOUNT_NUMBER" },
  { pattern: "sort code", entity: "SORT_CODE" },
  { pattern: "passport", entity: "PASSPORT" },
  { pattern: "password", entity: "PASSWORD" },
  { pattern: "credential", entity: "CREDENTIAL" },
  { pattern: "tax identifier", entity: "TAX_IDENTIFIER" },
  { pattern: "raw pii", entity: "RAW_PII" }
];

const deniedEntityTypes = new Set([
  "ACCOUNT_NUMBER",
  "CREDENTIAL",
  "CREDIT_CARD",
  "CRYPTO",
  "IBAN_CODE",
  "IP_ADDRESS",
  "NRP",
  "PASSPORT",
  "PASSWORD",
  "SORT_CODE",
  "TAX_IDENTIFIER",
  "UK_NATIONAL_INSURANCE_NUMBER",
  "US_SSN",
  "RAW_PII"
]);

function deniedDecision(confidence: number, detectedEntities: string[]): PiiGuardDecision {
  return {
    status: "denied",
    confidence,
    detectedEntities,
    reasoning: "The request asks for regulated identifiers beyond the data-minimized capability contract.",
    policyDecision: {
      name: "data_minimization",
      status: "requires_confirmation",
      detail: "The gateway can provide redacted account context or a review summary, not raw regulated identifiers."
    }
  };
}

export class LocalPiiGuardProvider implements PiiGuardProvider {
  async analyze(prompt: string): Promise<PiiGuardDecision> {
    const lower = prompt.toLowerCase();
    const detectedEntities = localSensitivePatterns
      .filter(({ pattern }) => lower.includes(pattern))
      .map(({ entity }) => entity);

    if (detectedEntities.length > 0) {
      return deniedDecision(0.98, [...new Set(detectedEntities)]);
    }

    return {
      status: "passed",
      confidence: 0,
      detectedEntities: [],
      reasoning: "No sensitive identifier disclosure pattern matched."
    };
  }
}

export class PresidioPiiGuardProvider implements PiiGuardProvider {
  constructor(
    private readonly analyzerUrl: string,
    private readonly fallback: PiiGuardProvider = new LocalPiiGuardProvider()
  ) {}

  async analyze(prompt: string): Promise<PiiGuardDecision> {
    const localDecision = await this.fallback.analyze(prompt);
    if (localDecision.status === "denied") return localDecision;

    const threshold = Number(process.env.PRESIDIO_SCORE_THRESHOLD ?? 0.65);
    let entities: PresidioEntity[];
    try {
      const response = await fetch(this.analyzerUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: prompt,
          language: process.env.PRESIDIO_LANGUAGE ?? "en"
        })
      });

      if (!response.ok) {
        throw new Error(`Presidio analyzer returned ${response.status}`);
      }

      entities = (await response.json()) as PresidioEntity[];
    } catch (error) {
      return {
        ...localDecision,
        reasoning: `Presidio analyzer unavailable; local PII fallback passed. ${
          error instanceof Error ? error.message : String(error)
        }`
      };
    }

    const deniedEntities = entities
      .filter((entity) => (entity.score ?? 0) >= threshold && deniedEntityTypes.has(entity.entity_type ?? ""))
      .map((entity) => entity.entity_type as string);

    if (deniedEntities.length > 0) {
      const maxScore = Math.max(...entities.map((entity) => entity.score ?? 0));
      return deniedDecision(Number(maxScore.toFixed(3)), [...new Set(deniedEntities)]);
    }

    return {
      status: "passed",
      confidence: 0,
      detectedEntities: entities.map((entity) => entity.entity_type).filter((entity): entity is string => Boolean(entity)),
      reasoning: "No regulated identifier entity crossed the PII guard threshold."
    };
  }
}

export function createPiiGuardProvider(): PiiGuardProvider {
  const analyzerUrl = process.env.PRESIDIO_ANALYZER_URL;
  if (!analyzerUrl) return new LocalPiiGuardProvider();
  return new PresidioPiiGuardProvider(analyzerUrl);
}
