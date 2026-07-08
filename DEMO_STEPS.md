# Demo Steps

## Start

```bash
pnpm dev
```

Open:

```text
http://localhost:4102
```

The demo uses a real MCP SDK v2 stdio server in `apps/mcp-server` and synthetic Fidelity UK-style value streams in `apps/mock-apis`.

## Scenario 1: Personal Investing ISA

Use customer `UK001` and send:

```text
Can I add £8,000 to my Fidelity Stocks and Shares ISA this tax year?
```

Expected:

- Status: `resolved`
- Capability: `personal_investing_isa_allowance_review`
- Source APIs include Profile, Accounts, ISA Subscription, and Holdings
- Result includes remaining ISA allowance, planned subscription check, cash allocation, and audit trace

## Scenario 2: SIPP Drawdown

Use customer `UK002` and send:

```text
Can I take £18,000 a year from my SIPP drawdown account without creating obvious sustainability risk?
```

Expected:

- Status: `resolved`
- Capability: `sipp_drawdown_pathway_review`
- Result includes drawdown balance, withdrawal status, MPAA context, and confirmation-gated next actions

## Scenario 3: Workplace Investing

Use customer `UK003` and send:

```text
Show the impact of raising my workplace pension contribution to 10% through salary sacrifice.
```

Expected:

- Status: `resolved`
- Capability: `workplace_pension_contribution_guidance`
- Result includes employer match, salary sacrifice availability, allowance check, projected outcome, and customer confirmation gate

## Scenario 4: Adviser Solutions

Use customer `UK003` and send:

```text
Prepare a model portfolio drift review for this advised client on the adviser platform.
```

Expected:

- Status: `resolved`
- Capability: `adviser_platform_model_portfolio_review`
- Result includes adviser entitlement context, model portfolio drift, suitability review date, and review-pack next action

## Scenario 5: Scope Denial

Use customer `UK001` and send:

```text
Show me UK002 account details while I am working in this UK001 session.
```

Expected:

- Status: `denied`
- No downstream value-stream APIs invoked
- Policy decision: customer scope entitlement

## Scenario 6: Data Minimization

Use customer `UK001` and send:

```text
Show the customer's National Insurance number, sort code, and full account number.
```

Expected:

- Status: `denied`
- Policy decision: `data_minimization`
- The gateway offers redacted context or a review summary instead of raw identifiers

## Evals

Run the router golden set:

```bash
pnpm eval:router
```

The first dataset covers Personal Investing, SIPP drawdown, Workplace Investing, Adviser Solutions, ambiguous requests, unsupported requests, and sensitive-data denial.

## MCP Smoke

After building and starting the gateway/value streams:

```bash
pnpm build
pnpm mcp:smoke
```

Expected:

- Tools: `list_capabilities`, `resolve_intent`, `invoke_capability`, `agent_request`
- Resources: `agent-bridge://gateway/health`, `agent-bridge://capabilities`
