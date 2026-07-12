export const appResourceUri = "ui://agent-bridge/app.html";

export function renderAppWidgetHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Agent-Bridge Card</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #17201c;
      --muted: #68726b;
      --line: #ddd4c2;
      --paper: #fffaf0;
      --track: #e8deca;
      --green: #1f5f50;
      --blue: #315c7b;
      --gold: #a57417;
      --red: #9c2d25;
      --ease: cubic-bezier(0.16, 1, 0.3, 1);
      font-family: ui-sans-serif, "Segoe UI", system-ui, sans-serif;
      background: transparent;
      color: var(--ink);
    }

    * { box-sizing: border-box; }
    html, body {
      width: fit-content;
      min-width: 280px;
      height: auto;
      margin: 0;
      overflow: hidden;
    }

    #root {
      width: fit-content;
      height: auto;
    }

    .card {
      width: min(100%, 520px);
      border: 1px solid var(--line);
      background: var(--paper);
      padding: 16px;
      opacity: 0;
      transform: translateY(8px);
      animation: arrive 520ms var(--ease) 80ms forwards;
    }

    .head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
    }

    h1 {
      margin: 0;
      font-size: 15px;
      line-height: 1.2;
      letter-spacing: 0;
    }

    .unit {
      color: var(--muted);
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .chart {
      display: grid;
      gap: 12px;
    }

    .row {
      display: grid;
      grid-template-columns: 76px minmax(0, 1fr) 42px;
      gap: 10px;
      align-items: center;
      color: #334039;
      font-size: 13px;
      font-weight: 760;
    }

    .label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .track {
      height: 16px;
      overflow: hidden;
      background: var(--track);
    }

    .fill {
      height: 100%;
      transform-origin: left center;
      animation: grow 780ms var(--ease) forwards;
    }

    .green { background: var(--green); }
    .blue { background: var(--blue); }
    .gold { background: var(--gold); }
    .red { background: var(--red); }

    .value {
      color: var(--ink);
      font-size: 12px;
      text-align: right;
    }

    .note {
      margin: 13px 0 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
    }

    .switcher {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 14px;
    }

    .switcher button {
      min-height: 30px;
      border: 1px solid var(--line);
      border-radius: 0;
      background: #f3ead9;
      color: #334039;
      padding: 5px 8px;
      font: inherit;
      font-size: 11px;
      font-weight: 850;
      cursor: pointer;
    }

    .switcher button.active {
      border-color: var(--green);
      background: var(--green);
      color: #fffaf0;
    }

    .state {
      display: grid;
      gap: 9px;
      margin-top: 12px;
    }

    .pill-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .pill {
      border: 1px solid var(--line);
      background: #f3ead9;
      color: #3c4741;
      padding: 5px 7px;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
    }

    .gate {
      border-top: 3px solid var(--gold);
      background: #f8efdc;
      padding: 11px;
    }

    .denial {
      border-top: 3px solid var(--red);
      background: #fff4ef;
      padding: 11px;
    }

    .routing {
      display: grid;
      gap: 7px;
      margin-top: 10px;
    }

    .routing div {
      border-left: 4px solid var(--blue);
      background: #f2ecdF;
      padding: 8px;
    }

    .routing strong {
      display: block;
      color: var(--ink);
      font-size: 11px;
      text-transform: uppercase;
    }

    .routing span {
      display: block;
      margin-top: 3px;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.35;
    }

    .error {
      border-color: #d4b6ad;
      background: #fff4ef;
    }

    @keyframes arrive {
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes grow {
      from { transform: scaleX(0); }
      to { transform: scaleX(1); }
    }

    @media (max-width: 420px) {
      .card { padding: 14px; }
      .row { grid-template-columns: 68px minmax(0, 1fr) 38px; gap: 8px; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
      }
    }
  </style>
</head>
<body>
  <main id="root"></main>
  <script>
    const fallbackChart = {
      title: "Portfolio mix",
      unit: "%",
      data: [
        { label: "Equity", value: 54, tone: "green" },
        { label: "Bonds", value: 28, tone: "blue" },
        { label: "Cash", value: 12, tone: "gold" },
        { label: "Other", value: 6, tone: "red" }
      ]
    };

    const root = document.getElementById("root");
    const PROTOCOL_VERSION = "2026-01-26";
    const HOST_TIMEOUT_MS = 5000;
    let nextRequestId = 1;
    let hostInitialized = false;
    let lastSize = { width: 0, height: 0 };
    const pending = new Map();

    function escapeHtml(value) {
      return String(value).replace(
        /[&<>"]/g,
        (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]
      );
    }

    const demoButtons = [
      ["isa-allowance-chart", "ISA"],
      ["sipp-confirmation-gate", "SIPP"],
      ["clarify-routing", "Clarify"],
      ["scope-denial", "Scope"],
      ["sensitive-data-minimization", "PII"]
    ];

    function renderFrame(inner, activeScenarioId) {
      root.innerHTML = \`
        <article class="card">
          <div class="switcher">
            \${demoButtons.map(([id, label]) => \`
              <button data-scenario="\${escapeHtml(id)}" class="\${id === activeScenarioId ? "active" : ""}">\${escapeHtml(label)}</button>
            \`).join("")}
          </div>
          \${inner}
        </article>
      \`;
      queueSizeChanged();
    }

    function chartHtml(chart, note) {
      const max = Math.max(...(chart.data || []).map((item) => Number(item.value) || 0), 1);
      return \`
          <div class="head">
            <h1>\${escapeHtml(chart.title || "Chart")}</h1>
            <span class="unit">\${escapeHtml(chart.unit || "")}</span>
          </div>
          <div class="chart">
            \${(chart.data || []).map((item) => \`
              <div class="row">
                <span class="label">\${escapeHtml(item.label)}</span>
                <div class="track">
                  <div class="fill \${escapeHtml(item.tone || "green")}" style="width:\${Math.round((Number(item.value) / max) * 100)}%"></div>
                </div>
                <strong class="value">\${escapeHtml(item.value)}</strong>
              </div>
            \`).join("")}
          </div>
          \${note ? \`<p class="note">\${escapeHtml(note)}</p>\` : ""}
      \`;
    }

    function renderChart(chart, note, activeScenarioId = "simple-chart") {
      renderFrame(chartHtml(chart, note), activeScenarioId);
    }

    function renderScenario(content, activeScenarioId) {
      const scenario = content?.scenario || {};
      const response = content?.response || {};
      const resolution = response.resolution || {};
      const result = response.result || {};
      const app = content?.app || {};
      const audit = content?.audit || null;
      const chart = result.chart || scenario.chart;
      const components = app.components || scenario.components || [];
      const trace = resolution.routingTrace || [];
      const status = resolution.status || scenario.expectedStatus || "pending";
      const summary = result.summary || resolution.reasoning || scenario.narrative || "Scenario completed.";

      let body = "";
      if (chart) {
        body += chartHtml(chart, summary);
      } else {
        body += \`
          <div class="head">
            <h1>\${escapeHtml(scenario.title || "Agent-Bridge scenario")}</h1>
            <span class="unit">\${escapeHtml(status)}</span>
          </div>
          <p class="note">\${escapeHtml(summary)}</p>
        \`;
      }

      body += \`
        <div class="state">
          <div class="pill-row">
            <span class="pill">\${escapeHtml(status)}</span>
            <span class="pill">\${escapeHtml(resolution.resolver || "gateway")}</span>
            \${response.result?.audit_trace_id ? \`<span class="pill">\${escapeHtml(response.result.audit_trace_id)}</span>\` : ""}
          </div>
        </div>
      \`;

      if (components.includes("confirmation_gate")) {
        body += \`
          <div class="gate">
            <strong>Confirmation required</strong>
            <p class="note">The agent can explain the recommendation, but execution-oriented actions remain gated.</p>
          </div>
        \`;
      }

      if (status === "denied" || components.includes("policy_denial")) {
        const policy = resolution.policyDecision;
        body += \`
          <div class="denial">
            <strong>\${escapeHtml(policy?.name || "Policy boundary")}</strong>
            <p class="note">\${escapeHtml(policy?.detail || resolution.reasoning || "The gateway did not disclose restricted data.")}</p>
          </div>
        \`;
      }

      if (trace.length) {
        body += \`
          <div class="routing">
            \${trace.slice(0, 5).map((step) => \`
              <div>
                <strong>\${escapeHtml(step.layer)} · \${escapeHtml(step.status)}</strong>
                <span>\${escapeHtml(step.detail)}</span>
              </div>
            \`).join("")}
          </div>
        \`;
      } else if (audit?.events?.length) {
        body += \`
          <div class="routing">
            \${audit.events.slice(0, 5).map((event) => \`
              <div>
                <strong>\${escapeHtml(event.type)}</strong>
                <span>\${escapeHtml(event.summary)}</span>
              </div>
            \`).join("")}
          </div>
        \`;
      }

      renderFrame(body, activeScenarioId);
    }

    function renderError(message) {
      renderFrame(\`
          <div class="head"><h1>Chart unavailable</h1></div>
          <p class="note">\${escapeHtml(message)}</p>
      \`, "simple-chart");
    }

    window.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || typeof data !== "object" || data.jsonrpc !== "2.0" || data.id == null) return;
      const handler = pending.get(data.id);
      if (!handler) return;
      clearTimeout(handler.timer);
      pending.delete(data.id);
      if (data.error) handler.reject(new Error(data.error.message || "MCP host error"));
      else handler.resolve(data.result);
    });

    function sendRequest(method, params) {
      return new Promise((resolve, reject) => {
        const id = nextRequestId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("Host did not respond"));
        }, HOST_TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer });
        window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
      });
    }

    function sendNotification(method, params) {
      window.parent.postMessage({ jsonrpc: "2.0", method, params }, "*");
    }

    function measureContent() {
      const rect = root.getBoundingClientRect();
      return {
        width: Math.ceil(Math.max(rect.width, document.documentElement.scrollWidth, 280)),
        height: Math.ceil(Math.max(rect.height, document.documentElement.scrollHeight))
      };
    }

    function notifySizeChanged(force = false) {
      const size = measureContent();
      if (!force && Math.abs(size.width - lastSize.width) < 1 && Math.abs(size.height - lastSize.height) < 1) return;
      lastSize = size;
      if (hostInitialized) {
        sendNotification("ui/notifications/size-changed", size);
      }
    }

    function queueSizeChanged() {
      requestAnimationFrame(() => {
        notifySizeChanged();
        setTimeout(notifySizeChanged, 120);
        setTimeout(notifySizeChanged, 700);
      });
    }

    new ResizeObserver(queueSizeChanged).observe(root);

    async function callTool(name, argumentsObject) {
      if (typeof window.openai?.callTool === "function") {
        return window.openai.callTool(name, argumentsObject || {});
      }

      await sendRequest("ui/initialize", {
        appInfo: { name: "agent-bridge-card", version: "1.0.0" },
        appCapabilities: {},
        protocolVersion: PROTOCOL_VERSION
      });
      hostInitialized = true;
      sendNotification("ui/notifications/initialized", {});
      notifySizeChanged(true);
      return sendRequest("tools/call", { name, arguments: argumentsObject || {} });
    }

    async function runScenario(scenarioId) {
      renderFrame(\`
        <div class="head"><h1>Running scenario</h1><span class="unit">\${escapeHtml(scenarioId)}</span></div>
        <p class="note">The MCP App is calling the gateway-backed scenario tool.</p>
      \`, scenarioId);

      try {
        const result = await callTool("run_demo_scenario", { scenarioId });
        const content = result.structuredContent || result;
        renderScenario(content, scenarioId);
      } catch (error) {
        if (scenarioId === "isa-allowance-chart") {
          renderChart(fallbackChart, "Fallback chart shown while the host tool bridge is unavailable.", scenarioId);
          return;
        }
        renderError(error instanceof Error ? error.message : String(error));
      }
    }

    root.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-scenario]");
      if (!button) return;
      runScenario(button.dataset.scenario);
    });

    async function boot() {
      renderChart(fallbackChart, "Select a scenario to render the governed MCP interaction.", "isa-allowance-chart");
      await runScenario("isa-allowance-chart");
    }

    boot();
  </script>
</body>
</html>`;
}
