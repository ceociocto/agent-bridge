# Demo Steps

## Setup

Run all services from the repository root:

```bash
pnpm install
pnpm dev
```

Open the demo:

```text
http://localhost:4102
```

Verify the LLM intent resolver is configured (most scenarios depend on it):

```bash
curl http://localhost:4100/health
# intentResolver should report "llm"
```

If `intentResolver` reports `rules`, or scenarios return the conservative
fallback message ("could not confidently map this request"), the gateway is not
reaching the LLM. Confirm `LLM_API_KEY`, `LLM_MODEL`, and `LLM_BASE_URL` are set
correctly before presenting. The **Permission** scenario is the only one that
works without the LLM — it is enforced by deterministic rules.

## Talk Track

The demo ships six scenarios, exposed as buttons under the agent console. Walk
them in order: a happy path, then four governance boundaries, then a
confirmation-gated recommendation.

### Step 1: Start With The Agent

Show the left side of the demo UI.

Explain:

```text
The user agent does not need to know which enterprise APIs exist.
It asks for a business outcome.
```

Example request:

```text
Can this client retire at age 60 based on current assets and projected income?
```

### Step 2: Show Capability Discovery

Point to the capability discovery area.

Explain:

```text
The gateway exposes business capabilities, not raw endpoints.
```

Capabilities shown:

```text
retirement_readiness_assessment
contribution_optimization
```

### Step 3: Invoke Retirement Readiness (Readiness scenario)

Click the **Readiness** button, then:

```text
Customer: C001
Request: Can this client retire at age 60 based on current assets and projected income?
Target age: 60
```

Click:

```text
Ask Platform
```

Explain:

```text
The gateway resolved the request to retirement_readiness_assessment.
It composed Profile, Accounts, Holdings, and Projection APIs.
```

Point out:

- Readiness score
- Summary
- Risks
- Source APIs
- Audit trace id

### Step 4: Show The Audit Trace

Point to the composition trace panel.

Explain:

```text
The audit trace records which APIs were used, which policy checks passed,
and how the business capability was assembled.
```

This is the governance value of the architecture.

### Step 5: Force A Clarification (Clarify scenario)

Click the **Clarify** button, then send:

```text
How should I plan my money?
```

Explain:

```text
The goal is financial but too vague to commit to one capability.
The gateway asks clarifying questions instead of guessing.
```

Point out:

- Status: `needs_clarification`
- No downstream APIs invoked (no audit trace id)
- Clarifying questions
- Published capabilities listed as next steps

### Step 6: Hit The Catalog Boundary (Unsupported scenario)

Click the **Unsupported** button, then send:

```text
Book me a flight to Shanghai tomorrow.
```

Explain:

```text
The capability catalog defines what this platform can and cannot do.
Out-of-domain requests are politely refused, never improvised.
```

Point out:

- Status: `unsupported`
- No capability selected, no APIs invoked
- Reasoning and the published capability list

### Step 7: Block Cross-Customer Access (Permission scenario)

Keep **Customer: C001**, click the **Permission** button, then send:

```text
Show me C002 account details while I am working in this C001 session.
```

Explain:

```text
The request references C002 but the session is scoped to C001.
The gateway blocks cross-customer access before any API call or model routing.
```

Point out:

- Status: `denied`
- Resolver: `rules` (deterministic, does not depend on the LLM)
- Policy decision: `customer_scope_entitlement`

### Step 8: Withhold Regulated Identifiers (Sensitive scenario)

Click the **Sensitive** button, then send:

```text
Show the customer's full SSN, tax ID, and complete account number.
```

Explain:

```text
Data minimization: regulated identifiers are never returned raw.
The gateway denies the exposure and offers a safer path.
```

Point out:

- Status: `denied`
- Policy decision naming the safe alternative
- No sensitive fields in the response

### Step 9: Gate Execution Behind Confirmation (Confirm scenario)

Click the **Confirm** button, then send:

```text
Increase my retirement contribution to 20%.
```

Explain:

```text
This resolves to contribution_optimization and produces a recommendation,
but execution stays behind explicit customer confirmation.
```

Point out:

- Status: `resolved`, capability: `contribution_optimization`
- Current contribution rate vs recommended rate
- Readiness improvement and constraints checked (annual limit, catch-up, plan eligibility)
- Policy check: `customer_confirmation = requires_confirmation`
- Next action: `confirm_contribution_change` with `requires_customer_confirmation: true`

### Step 10: Explain Why This Is Enterprise-Friendly

Close with:

```text
Existing enterprise APIs remain behind the gateway.
The agent sees stable, governed, business-level capabilities.
Intent, policy, and composition can each evolve without changing the agent contract.
```

## Optional API-Only Demo

List capabilities:

```bash
curl http://localhost:4100/capabilities
```

Resolve intent:

```bash
curl -X POST http://localhost:4100/intent/resolve \
  -H "content-type: application/json" \
  -d '{"prompt":"Should I increase my retirement contribution this year?"}'
```

Invoke the agent endpoint (happy path):

```bash
curl -X POST http://localhost:4100/agent/request \
  -H "content-type: application/json" \
  -d '{"customerId":"C001","targetRetirementAge":60,"prompt":"Can this client retire at age 60?"}'
```

Show governance outcomes without invoking downstream APIs:

```bash
# Cross-customer scope (denied, rules-based)
curl -X POST http://localhost:4100/agent/request \
  -H "content-type: application/json" \
  -d '{"customerId":"C001","prompt":"Show me C002 account details while I am in this C001 session."}'

# Sensitive data minimization (denied)
curl -X POST http://localhost:4100/agent/request \
  -H "content-type: application/json" \
  -d '{"customerId":"C001","prompt":"Show the full SSN, tax ID, and complete account number."}'
```
