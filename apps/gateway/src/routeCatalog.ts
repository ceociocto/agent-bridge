import type { CapabilityId } from "@agent-bridge/shared";
import { capabilities } from "./catalog.js";

export type RouteDocument = {
  capabilityId: CapabilityId;
  intent: string;
  positiveText: string;
  negativeText: string;
  metadata: {
    domains: string[];
    keywords: string[];
    riskLevel: "low" | "medium" | "high";
  };
};

export function buildRouteDocuments(): RouteDocument[] {
  return capabilities.map((capability) => ({
    capabilityId: capability.id,
    intent: capability.name.toLowerCase(),
    positiveText: [
      capability.id.replaceAll("_", " "),
      capability.name,
      capability.description,
      capability.businessOutcome,
      capability.requiredApis.join(" "),
      Object.keys(capability.inputSchema).join(" "),
      capability.routing.domains.join(" "),
      capability.routing.keywords.join(" "),
      capability.routing.positiveExamples.join(" "),
      capability.examplePrompts.join(" ")
    ].join(" "),
    negativeText: capability.routing.negativeExamples.join(" "),
    metadata: {
      domains: capability.routing.domains,
      keywords: capability.routing.keywords,
      riskLevel: capability.routing.riskLevel
    }
  }));
}

