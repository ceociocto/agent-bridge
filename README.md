# Agent-Bridge POC

Agent-Bridge is a runnable POC for an agent-friendly financial service interface model.

It demonstrates how a customer-facing agent can call a governed capability gateway instead of calling raw enterprise APIs directly.

## Executive Summary

The POC shows a small but realistic pattern for enterprise AI integration:

```text
User / Agent
  -> Capability Gateway
  -> Intent Resolution
  -> Policy and Permission Checks
  -> Capability Composition
  -> Existing Enterprise APIs
  -> Audit-Friendly Agent Response
```

The important idea is that the agent does not receive unrestricted backend API access. It can only invoke published business capabilities, and each capability can enforce scope, consent, confirmation, data minimization, and audit controls.

## Services

| Service | Port | Purpose |
|---|---:|---|
| `apps/mock-apis` | `4101` | Simulates existing enterprise value stream APIs. |
| `apps/gateway` | `4100` | Capability gateway, intent resolver, policy checks, and composition layer. |
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

If `4102` is already in use, Vite will print the alternate local URL.

## LLM-Based Intent Resolution

The gateway uses an OpenAI-compatible LLM API to return a structured resolution:

```json
{
  "status": "resolved | needs_clarification | unsupported | denied",
  "intent": "short intent label",
  "capabilityId": "retirement_readiness_assessment",
  "confidence": 0.91,
  "reasoning": "why this decision was made",
  "questions": [],
  "policyDecision": null
}
```

Configure the resolver with a local `.env`:

```bash
cp .env.example .env
```

Set:

```env
LLM_API_KEY=your-api-key
LLM_MODEL=your-chat-model
LLM_BASE_URL=https://your-openai-compatible-endpoint/v1
LLM_TIMEOUT_MS=30000
LLM_RESPONSE_FORMAT=none
INTENT_RESOLUTION_MIN_CONFIDENCE=0.62
```

For example, if the provider exposes an OpenAI-compatible chat completions API, `LLM_BASE_URL` can point to that endpoint and `LLM_MODEL` can be set to the provider model name. `LLM_RESPONSE_FORMAT` defaults to `none` for broader provider compatibility. Set it to `json_object` only when the provider supports OpenAI-style JSON response format.

If no LLM is configured, or if the LLM call fails, the gateway uses a conservative fallback:

```text
unsupported
```

It does not guess a default business capability from free-form text.

## Key Endpoints

```text
GET  http://localhost:4100/health
GET  http://localhost:4100/capabilities
POST http://localhost:4100/intent/resolve
POST http://localhost:4100/agent/request
POST http://localhost:4100/capabilities/:capabilityId/invoke
GET  http://localhost:4100/audit/:traceId
```

## Current POC Scope

The gateway exposes two business capabilities:

1. `retirement_readiness_assessment`
2. `contribution_optimization`

Each capability composes multiple mock value stream APIs and returns an agent-readable result with:

- selected capability
- source APIs
- policy checks
- next actions
- customer confirmation requirements
- audit trace id

The demo web app includes governed scenarios for:

- clear capability resolution
- low-confidence intent requiring clarification
- unsupported requests outside the published catalog
- cross-customer permission denial
- sensitive identifier minimization
- recommendation-only actions that require customer confirmation

## Current Governance Model

| Control | Current POC Implementation | Production Direction |
|---|---|---|
| Capability catalog | Static local catalog in code | Versioned enterprise capability registry |
| Intent resolution | LLM structured classifier with JSON schema | Evaluated router with model governance and fallback strategy |
| Unsupported requests | LLM returns `unsupported`; no capability invoked | Policy-backed no-match handling and product telemetry |
| Clarification | LLM returns `needs_clarification` and questions | Slot-filling workflow and conversation state |
| Customer scope | Deterministic request-context check | Identity, entitlement, and relationship-based access control |
| Sensitive data | LLM can return `denied` with policy decision | Dedicated PII classifier, DLP, tokenization, and masking |
| Confirmation | Capability policy marks high-impact action as confirmation-required | Consent artifacts, approval workflows, and non-repudiation |
| Audit | In-memory trace record | Immutable audit store, trace correlation, and SIEM integration |

## AWS-Oriented Productization Roadmap

This roadmap is written for engineering, product, architecture, risk, compliance, and management stakeholders. It separates product value from implementation work so the platform can evolve incrementally.

### Phase 1: POC Hardening

Goal: make the current demo reliable enough for stakeholder review.

Product outcomes:

- Demonstrate agent-safe access to enterprise capabilities.
- Show that unsupported, ambiguous, sensitive, and unauthorized requests are handled safely.
- Provide clear demo narratives for business and risk teams.

Engineering tasks:

- Add regression tests for the six demo scenarios.
- Add test cases for unrelated prompts such as travel, shopping, weather, and general chat.
- Add test cases for vague financial prompts and missing required slots.
- Add test cases for sensitive identifiers and cross-customer access.
- Add structured logs for each gateway decision.
- Persist audit records outside process memory for local development.

Acceptance criteria:

- No unrelated user prompt invokes a financial capability.
- Low-confidence requests return clarification.
- Denied requests do not invoke downstream APIs.
- Each request has a traceable decision record.

### Phase 2: Capability Registry

Goal: move from hardcoded capabilities to governed capability lifecycle management.

Product outcomes:

- Product and platform teams can publish, review, and retire capabilities.
- Each capability has business ownership, policy metadata, example prompts, and risk classification.
- Agents only see capabilities approved for their channel and user context.

Engineering tasks:

- Create a capability registry schema.
- Add metadata fields for owner, domain, version, risk level, allowed channels, required entitlements, required consent, and data classification.
- Store registry data in AWS DynamoDB or Amazon Aurora.
- Add registry versioning and rollback.
- Add admin workflow for capability review and approval.
- Expose read-only capability discovery endpoint for agents.

AWS candidates:

- DynamoDB for low-latency registry storage.
- Aurora PostgreSQL if relational governance queries are important.
- API Gateway plus Lambda or ECS/Fargate for registry APIs.
- AWS CloudTrail for administrative change tracking.

### Phase 3: Intent Routing and Model Governance

Goal: make routing measurable, testable, and model-provider independent.

Product outcomes:

- Business teams can understand why a request was routed, clarified, denied, or rejected.
- Risk teams can review model behavior through evals and decision logs.
- The platform can switch or compare model providers without redesigning gateway logic.

Engineering tasks:

- Keep the LLM router output schema strict and versioned.
- Add a golden evaluation dataset for supported, unsupported, ambiguous, sensitive, and malicious prompts.
- Add confidence thresholds per capability risk level.
- Add offline eval reports before model or prompt changes.
- Add online telemetry for routing status, confidence, fallback rate, and denial rate.
- Consider an embedding router later when the capability catalog grows beyond a small number of capabilities.

AWS candidates:

- Amazon Bedrock for managed model access if selected by enterprise architecture.
- Amazon SageMaker for custom model hosting or evaluation pipelines.
- S3 for eval datasets and results.
- CloudWatch dashboards for routing metrics.

Important note:

For the current POC, an LLM structured classifier is sufficient. An embedding semantic router is most useful later when the catalog contains many capabilities and the platform needs cheaper candidate recall before final LLM classification.

### Phase 4: Identity, Entitlement, and Consent

Goal: ensure every agent action is scoped to the authenticated user, customer, advisor, channel, and consent state.

Product outcomes:

- The platform can answer: who requested what, for whom, through which channel, under what authority.
- Advisors and customers only access permitted customer records.
- High-impact actions require explicit confirmation or approval.

Engineering tasks:

- Integrate enterprise identity provider.
- Add OAuth/OIDC token validation.
- Add customer relationship and account ownership checks.
- Add role-based and attribute-based access control.
- Add consent artifacts for data sharing and action execution.
- Add confirmation workflow for recommendation-to-action transitions.
- Add deny-by-default behavior when entitlement context is missing.

AWS candidates:

- Amazon Cognito if suitable for the channel identity layer.
- IAM Identity Center or enterprise IdP integration for workforce users.
- Amazon Verified Permissions for fine-grained authorization policies.
- DynamoDB/Aurora for consent and relationship records.
- KMS for encrypting consent artifacts and sensitive records.

### Phase 5: Data Governance and Sensitive Data Protection

Goal: prevent accidental exposure of regulated, personal, or account-sensitive data.

Product outcomes:

- Agents receive only the minimum data required to complete the business capability.
- Sensitive identifiers are masked, tokenized, or withheld.
- Compliance can audit why data was exposed or denied.

Engineering tasks:

- Define data classification levels for each field returned by enterprise APIs.
- Add field-level response filtering and masking.
- Add PII detection for user prompts and generated responses.
- Add data minimization rules per capability.
- Add secure redaction of logs and audit traces.
- Add policy tests for SSN, tax ID, full account number, credentials, and account transfer data.

AWS candidates:

- Amazon Macie for sensitive data discovery in S3-based datasets.
- AWS KMS for encryption.
- AWS Secrets Manager for API credentials.
- CloudWatch log redaction controls or a dedicated logging pipeline.
- AWS Glue Data Catalog if broader data classification is needed.

### Phase 6: API Composition and Enterprise Integration

Goal: replace mock APIs with governed enterprise sandbox APIs and then production APIs.

Product outcomes:

- Capabilities compose existing value-stream APIs without exposing raw API complexity to agents.
- Each capability can provide evidence, assumptions, source systems, and next actions.
- The gateway becomes a stable abstraction over changing backend systems.

Engineering tasks:

- Define adapter contracts for each value-stream API.
- Add timeout, retry, circuit breaker, and partial failure handling.
- Add source-system provenance to every result.
- Add schema validation for upstream and downstream payloads.
- Add environment separation for mock, sandbox, staging, and production.
- Add contract tests with enterprise API teams.

AWS candidates:

- API Gateway for managed API front doors.
- ECS/Fargate or Lambda for gateway and adapters.
- EventBridge for asynchronous business events.
- Step Functions for long-running or approval-based workflows.
- PrivateLink/VPC integration for private enterprise APIs.

### Phase 7: Audit, Observability, and Risk Reporting

Goal: make every agent decision explainable and reviewable.

Product outcomes:

- Risk, compliance, and operations teams can review agent activity.
- Product teams can see unsupported demand and prioritize new capabilities.
- Engineering teams can diagnose model, policy, and backend failures.

Engineering tasks:

- Persist immutable audit records.
- Correlate user prompt, resolution, policy decision, capability invocation, source APIs, and response.
- Add dashboards for resolution status, policy denials, confirmation requirements, latency, and errors.
- Add alerting for unusual denial spikes, high-risk prompts, and repeated unsupported demand.
- Add retention and deletion policies.

AWS candidates:

- CloudWatch Logs and Metrics.
- AWS X-Ray or OpenTelemetry collectors for tracing.
- S3 with Object Lock for immutable audit storage where required.
- OpenSearch for investigation workflows.
- Security Hub or SIEM integration for security monitoring.

### Phase 8: Production Operating Model

Goal: turn the gateway into a controlled enterprise platform capability.

Product outcomes:

- Clear ownership across product, platform, risk, compliance, security, and business domains.
- Repeatable process for onboarding new capabilities.
- Measurable improvement in agent usefulness without expanding uncontrolled API access.

Engineering and operating tasks:

- Define capability onboarding checklist.
- Define model and prompt change management process.
- Define incident response for incorrect routing, data exposure, and unauthorized action attempts.
- Add blue/green or canary deployment.
- Add disaster recovery and service-level objectives.
- Add cost tracking by capability, model, channel, and business unit.
- Add human review process for high-risk or low-confidence interactions.

AWS candidates:

- CodePipeline or GitHub Actions with AWS deployment targets.
- ECS/Fargate or EKS for long-running services.
- Lambda for event-driven adapters.
- AWS Budgets and Cost Explorer for cost management.
- AWS WAF and Shield for external-facing endpoints.

## Suggested Near-Term Backlog

1. Add automated tests for the current six governed scenarios.
2. Add a small eval dataset for supported, unsupported, ambiguous, sensitive, and unauthorized prompts.
3. Add persistent local audit storage.
4. Add capability registry metadata fields.
5. Add per-capability risk level and confidence threshold.
6. Add response masking for sensitive output fields.
7. Add authorization policy abstraction before integrating real identity.
8. Add AWS deployment sketch for gateway, registry, audit store, and mock/sandbox APIs.
9. Add observability dashboard definitions.
10. Add product-facing capability onboarding template.

## Design Principle

LLMs should help understand user intent, but they should not replace enterprise controls.

The target production pattern is:

```text
LLM for semantic understanding
Policy engine for permission and governance
Capability gateway for controlled business execution
Audit system for accountability
```
