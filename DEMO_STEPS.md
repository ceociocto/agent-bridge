# Demo Steps

For the current customer/adviser Agentic Web walkthrough, including dynamic replanning, durable workflows, and presenter notes, use [AGENTIC_WEB_DEMO_GUIDE.md](./AGENTIC_WEB_DEMO_GUIDE.md).

## Start

```bash
pnpm dev
```

Open:

```text
http://localhost:4102
```

The demo uses a real MCP SDK v2 stdio server in `apps/mcp-server` and synthetic Fidelity UK-style value streams in `apps/mock-apis`. The MCP server now also exposes app-oriented resources and scenario tools for clients that support MCP Apps-style UI templates, while remaining usable from generic MCP agents.

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
- App component pattern: allowance chart plus routing trace

## Scenario 2: SIPP Drawdown

Use customer `UK002` and send:

```text
Can I take £18,000 a year from my SIPP drawdown account without creating obvious sustainability risk?
```

Expected:

- Status: `resolved`
- Capability: `sipp_drawdown_pathway_review`
- Result includes drawdown balance, withdrawal status, MPAA context, and confirmation-gated next actions
- App component pattern: drawdown risk, confirmation gate, and routing trace

## Scenario 3: Workplace Investing

Use customer `UK003` and send:

```text
Show the impact of raising my workplace pension contribution to 10% through salary sacrifice.
```

Expected:

- Status: `resolved`
- Capability: `workplace_pension_contribution_guidance`
- Result includes employer match, salary sacrifice availability, allowance check, projected outcome, and customer confirmation gate
- App component pattern: contribution projection, confirmation gate, and multi-panel evidence

## Scenario 4: Adviser Solutions

Use customer `UK003` and send:

```text
Prepare a model portfolio drift review for this advised client on the adviser platform.
```

Expected:

- Status: `resolved`
- Capability: `adviser_platform_model_portfolio_review`
- Result includes adviser entitlement context, model portfolio drift, suitability review date, and review-pack next action
- App component pattern: portfolio drift review plus source evidence

## Scenario 5: Scope Denial

Use customer `UK001` and send:

```text
Show me UK002 account details while I am working in this UK001 session.
```

Expected:

- Status: `denied`
- No downstream value-stream APIs invoked
- Policy decision: customer scope entitlement
- App component pattern: policy denial panel

## Scenario 6: Data Minimization

Use customer `UK001` and send:

```text
Show the customer's National Insurance number, sort code, and full account number.
```

Expected:

- Status: `denied`
- Policy decision: `data_minimization`
- The gateway offers redacted context or a review summary instead of raw identifiers
- App component pattern: sensitive-data policy boundary

## Scenario 7: Clarification

Use customer `UK001` and send:

```text
How should I plan my money?
```

Expected:

- Status: `needs_clarification`
- No downstream value-stream APIs invoked
- Available governed capabilities are returned
- App component pattern: routing trace plus capability boundary

## Scenario 8: Unsupported Boundary

Use customer `UK001` and send:

```text
Book me a flight to Shanghai tomorrow.
```

Expected:

- Status: `unsupported`
- No downstream value-stream APIs invoked
- The response explains that the request is outside the published catalog
- App component pattern: catalog boundary plus routing trace

## MCP Apps Scenarios

After building and starting the gateway/value streams, generic MCP clients can run the app scenario tools directly:

```text
Use agent-bridge to open the Agent-Bridge app.
Use agent-bridge to list demo scenarios.
Use agent-bridge to run scenario simple-chart.
Use agent-bridge to run scenario isa-allowance-chart.
Use agent-bridge to run scenario sipp-confirmation-gate.
Use agent-bridge to run scenario scope-denial.
```

Start with `simple-chart` when testing VS Code Copilot or another new MCP app host. It is intentionally tiny: one static bar chart, a short summary, and no gateway/audit payload.

Apps-capable MCP clients can render:

```text
ui://agent-bridge/app.html
```

The widget presents a compact card with slow fade-in rendering and only the core scenario component. For `simple-chart`, that means one chart card. Trace, audit, and backend-management visualizations are intentionally excluded from the conversation widget.

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

- Tools: `list_capabilities`, `resolve_intent`, `invoke_capability`, `agent_request`, `open_agent_bridge_app`, `list_demo_scenarios`, `run_demo_scenario`
- Resources: `agent-bridge://gateway/health`, `agent-bridge://capabilities`, `agent-bridge://demo/scenarios`, `ui://agent-bridge/app.html`
