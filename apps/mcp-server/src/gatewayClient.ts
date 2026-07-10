import type {
  AgentReadableResult,
  CapabilityDefinition,
  CapabilityId,
  CapabilityInvokeInput,
  IntentResolution
} from "@agent-bridge/shared";

const defaultGatewayUrl = "http://localhost:4100";

export type GatewayHealth = {
  service: string;
  status: string;
  intentResolver: string;
};

export type CapabilityListResponse = {
  interface: string;
  capabilities: CapabilityDefinition[];
};

export type AgentRequestResponse = {
  prompt: string;
  resolution: IntentResolution;
  capability?: CapabilityDefinition;
  result?: AgentReadableResult;
};

export function getGatewayBaseUrl() {
  return (process.env.CAPABILITY_GATEWAY_URL ?? defaultGatewayUrl).replace(/\/+$/, "");
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${getGatewayBaseUrl()}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers
    }
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const detail = body && typeof body === "object" && "error" in body ? String(body.error) : text;
    throw new Error(`Gateway request failed: ${response.status} ${response.statusText} ${detail}`);
  }

  return body as T;
}

export const gatewayClient = {
  health: () => requestJson<GatewayHealth>("/health"),
  capabilities: () => requestJson<CapabilityListResponse>("/capabilities"),
  audit: (traceId: string) => requestJson<unknown>(`/audit/${encodeURIComponent(traceId)}`),
  resolveIntent: (prompt: string) =>
    requestJson<IntentResolution>("/intent/resolve", {
      method: "POST",
      body: JSON.stringify({ prompt })
    }),
  invokeCapability: (capabilityId: CapabilityId, input: CapabilityInvokeInput) =>
    requestJson<AgentReadableResult>(`/capabilities/${capabilityId}/invoke`, {
      method: "POST",
      body: JSON.stringify(input)
    }),
  agentRequest: (input: CapabilityInvokeInput & { prompt: string }) =>
    requestJson<AgentRequestResponse>("/agent/request", {
      method: "POST",
      body: JSON.stringify(input)
    })
};
