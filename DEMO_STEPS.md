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

## Talk Track

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

### Step 3: Invoke Retirement Readiness

Use:

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

### Step 5: Invoke Contribution Optimization

Use:

```text
Customer: C001
Request: Should I increase my retirement contribution this year?
```

Click:

```text
Ask Platform
```

Explain:

```text
This request reuses Profile, Accounts, and Projection,
but adds Contribution and Tax Limits APIs.
```

Point out:

- Current contribution rate
- Recommended contribution rate
- Readiness improvement
- Constraints checked
- `requires_customer_confirmation: true`

### Step 6: Explain Why This Is Enterprise-Friendly

Close with:

```text
Existing enterprise APIs remain behind the gateway.
The agent sees stable, governed, business-level capabilities.
The composition layer can evolve without changing the agent contract.
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

Invoke the agent endpoint:

```bash
curl -X POST http://localhost:4100/agent/request \
  -H "content-type: application/json" \
  -d '{"customerId":"C001","targetRetirementAge":60,"prompt":"Can this client retire at age 60?"}'
```
