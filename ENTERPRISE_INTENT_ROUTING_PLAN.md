# Enterprise Intent Routing Implementation Plan

## Target Architecture

```text
request
  -> PII guard
  -> policy pre-check
  -> deterministic rules guard
  -> semantic router top-K
  -> optional LLM adjudicator
  -> action policy check
  -> capability invocation
  -> audit and eval feedback
```

The semantic router remains a TypeScript-owned business component. External
governance tools are integrated as replaceable adapters instead of becoming the
router itself.

## Phase 1: Route Catalog Assets

Status: in progress

- Move routing examples, negative examples, keywords, domains, and risk labels
  into the capability catalog.
- Use positive examples to improve semantic matching.
- Use negative examples as a local penalty signal to reduce cross-domain
  misroutes.
- Keep existing intent response and routing trace shapes stable.

## Phase 2: Embedding And Vector Adapter

Status: planned

- Add an `EmbeddingProvider` interface.
- Add a `RouteVectorStore` interface with in-memory, pgvector, and HTTP-backed
  implementation boundaries.
- Preserve the current token-vector router as the offline fallback.
- Add route index versioning so catalog changes can be audited and rolled back.

## Phase 3: Policy-As-Code Adapter

Status: planned

- Add a `PolicyDecisionProvider` interface.
- Start with an in-process stub that mirrors current policy behavior.
- Add an OPA HTTP adapter for entitlement, channel, risk, confirmation, and
  data-access decisions.
- Run policy checks before LLM adjudication and before capability invocation.

## Phase 4: PII Guard Adapter

Status: planned

- Add a `PiiGuardProvider` interface.
- Keep the current string-based sensitive pattern guard as local fallback.
- Add a Presidio-compatible HTTP adapter for PII detection and anonymization.
- Record detected entity types and redaction decisions in the audit trace.

## Phase 5: Evaluation And Operations

Status: planned

- Expand router golden cases with negative examples and adversarial mixed-domain
  prompts.
- Add security eval support for policy and PII guard behavior.
- Track per-layer latency, resolver, confidence, selected candidates, and policy
  decisions.
- Require eval pass before catalog, prompt, threshold, or policy changes.

