import { buildRouteDocuments } from "./routeCatalog.js";
import { LocalRouteVectorStore, type RouteSearchResult } from "./routeVectorStore.js";

export type SemanticCandidate = RouteSearchResult["candidates"][number];

export type SemanticRouterResult = RouteSearchResult;

const localRouteStore = new LocalRouteVectorStore(buildRouteDocuments());

export function getSemanticThresholds() {
  return {
    resolve: Number(process.env.SEMANTIC_ROUTER_RESOLVE_THRESHOLD ?? 0.18),
    unsupported: Number(process.env.SEMANTIC_ROUTER_UNSUPPORTED_THRESHOLD ?? 0.08),
    margin: Number(process.env.SEMANTIC_ROUTER_MARGIN_THRESHOLD ?? 0.05),
    topK: Number(process.env.SEMANTIC_ROUTER_TOP_K ?? 3)
  };
}

export function routeIntentSemantically(prompt: string): SemanticRouterResult {
  const { topK } = getSemanticThresholds();
  return localRouteStore.search(prompt, { topK });
}

