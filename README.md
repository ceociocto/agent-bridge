# Agent-Bridge POC

This repository contains a runnable POC for an agent-friendly financial service interface model.

It demonstrates how a customer-facing agent can call a platform capability gateway instead of calling raw enterprise APIs directly.

## Services

| Service | Port | Purpose |
|---|---:|---|
| `apps/mock-apis` | `4101` | Simulates existing enterprise value stream APIs. |
| `apps/gateway` | `4100` | Simulates an MCP-style capability gateway and semantic composition layer. |
| `apps/demo-web` | `4102` | Simulates a user agent connecting to the gateway. |

## Run

```bash
pnpm install
pnpm dev
```

Open:

```text
http://localhost:4102
```

## Optional Real LLM Intent Resolver

The capability catalog is still a local business capability catalog, and the value stream APIs are still mock services for the POC. Intent resolution can call a real OpenAI-compatible LLM service when `.env` is configured:

```bash
cp .env.example .env
```

Set `LLM_API_KEY`, `LLM_MODEL`, and optionally `LLM_BASE_URL`. If those values are missing, or if the LLM call fails, the gateway falls back to the built-in rule resolver so the demo keeps running.

## Key Endpoints

```text
GET  http://localhost:4100/capabilities
POST http://localhost:4100/intent/resolve
POST http://localhost:4100/agent/request
POST http://localhost:4100/capabilities/:capabilityId/invoke
GET  http://localhost:4100/audit/:traceId
```

## POC Scope

The gateway exposes two business capabilities:

1. `retirement_readiness_assessment`
2. `contribution_optimization`

Each capability composes multiple mock value stream APIs and returns an agent-readable result with source APIs, policy checks, next actions, and an audit trace id.

The demo web app also includes governed scenarios for:

- Low-confidence intent requiring clarification
- Unsupported requests outside the published capability catalog
- Cross-customer permission denial
- Sensitive identifier minimization
- Recommendation-only actions that require customer confirmation
