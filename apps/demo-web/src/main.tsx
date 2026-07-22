import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BadgeCheck,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  ClipboardList,
  Database,
  FileCode2,
  Filter,
  Gauge,
  GitBranch,
  Landmark,
  Layers3,
  Loader2,
  LockKeyhole,
  MessageSquareText,
  Network,
  PanelsTopLeft,
  Play,
  Route,
  Satellite,
  Search,
  SendHorizontal,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal
} from "lucide-react";
import { demoScenarios, type DemoScenario } from "@agent-bridge/shared";
import "./styles.css";

const gatewayBaseUrl = import.meta.env.VITE_GATEWAY_URL ?? "http://localhost:4100";

type Capability = {
  id: string;
  version: string;
  owner: string;
  status: "draft" | "active" | "deprecated";
  name: string;
  description: string;
  businessOutcome: string;
  requiredApis: string[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  dataClassification: string;
  executionPlan: {
    mode: string;
    steps: Array<{
      id: string;
      type: string;
      uses?: string;
      description: string;
    }>;
  };
  routing: {
    domains: string[];
    keywords: string[];
    positiveExamples: string[];
    negativeExamples: string[];
    riskLevel: string;
  };
  policy: {
    dataAccess: string;
    requiresCustomerConfirmation: boolean;
    auditRequired: boolean;
  };
};

type AgentResponse = {
  prompt: string;
  resolution: {
    status?: "resolved" | "needs_clarification" | "unsupported" | "denied";
    intent?: string;
    capabilityId?: string;
    confidence: number;
    reasoning: string;
    resolver?: "llm" | "rules" | "semantic" | "fallback";
    questions?: string[];
    availableCapabilities?: string[];
    policyDecision?: { name: string; status: string; detail: string };
    routingTrace?: Array<{
      layer: string;
      status: string;
      detail: string;
      capabilityId?: string;
      confidence?: number;
      candidates?: Array<{
        capabilityId: string;
        score: number;
        matchedTerms?: string[];
      }>;
    }>;
  };
  capability?: Capability;
  result?: Record<string, unknown> & {
    summary?: string;
    source_apis?: string[];
    audit_trace_id?: string;
    policy_checks?: Array<{ name: string; status: string; detail: string }>;
    next_actions?: Array<Record<string, unknown>>;
  };
};

type AuditRecord = {
  traceId: string;
  requestId: string;
  capabilityVersion: string;
  sourceApis: string[];
  policyChecks: Array<{ name: string; status: string; detail: string }>;
  compositionSteps: Array<{ name: string; status: string; detail: string }>;
  events: Array<{
    id: string;
    timestamp: string;
    type: string;
    summary: string;
    detail?: string;
  }>;
};

type McpConversationSession = {
  id: string;
  clientName: string;
  startedAt: string;
  updatedAt: string;
  status: "active" | "completed" | "failed";
  stepCount: number;
  lastSummary: string;
  traceIds: string[];
  capabilityIds: string[];
  steps: Array<{
    id: string;
    timestamp: string;
    sequence: number;
    actor: string;
    kind: string;
    name: string;
    status: string;
    summary: string;
    traceId?: string;
    capabilityId?: string;
  }>;
};

const scenarios = demoScenarios;

const agenticQuestions = scenarios
  .filter((scenario) => scenario.id !== "simple-chart")
  .map((scenario) => ({
    id: scenario.id,
    label: scenario.label,
    prompt: scenario.prompt,
    group: scenario.group,
    tags: [
      scenario.capabilityId?.replaceAll("_", " ") ?? scenario.expectedStatus,
      scenario.interactionPattern.replaceAll("-", " ")
    ]
  }));

function App() {
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [activeScenarioId, setActiveScenarioId] = useState(scenarios[0].id);
  const [response, setResponse] = useState<AgentResponse | null>(null);
  const [audit, setAudit] = useState<AuditRecord | null>(null);
  const [mcpSessions, setMcpSessions] = useState<McpConversationSession[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${gatewayBaseUrl}/capabilities`)
      .then((res) => res.json())
      .then((data) => setCapabilities(data.capabilities ?? []))
      .catch(() => setError("Gateway is not reachable. Start the POC services with pnpm dev."));
  }, []);

  async function refreshMcpSessions() {
    const res = await fetch(`${gatewayBaseUrl}/mcp/sessions?limit=8`);
    if (res.ok) {
      const data = await res.json() as { sessions?: McpConversationSession[] };
      setMcpSessions(data.sessions ?? []);
    }
  }

  useEffect(() => {
    void refreshMcpSessions();
    const timer = window.setInterval(() => void refreshMcpSessions(), 4000);
    return () => window.clearInterval(timer);
  }, []);

  const selectedCapability = useMemo(() => response?.capability ?? capabilities[0], [capabilities, response]);
  const activeScenario = scenarios.find((scenario) => scenario.id === activeScenarioId) ?? scenarios[0];

  function applyScenario(scenario: DemoScenario) {
    setActiveScenarioId(scenario.id);
    setResponse(null);
    setAudit(null);
    setError("");
  }

  async function askAgent() {
    setLoading(true);
    setError("");
    setAudit(null);
    try {
      if (activeScenario.executionMode === "static") {
        setResponse({
          prompt: activeScenario.prompt,
          resolution: {
            status: activeScenario.expectedStatus,
            confidence: 1,
            reasoning: activeScenario.narrative,
            resolver: "rules"
          },
          result: {
            summary: activeScenario.narrative,
            chart: activeScenario.chart
          }
        });
        return;
      }

      const res = await fetch(`${gatewayBaseUrl}/agent/request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...activeScenario.input,
          prompt: activeScenario.prompt
        })
      });
      if (!res.ok) throw new Error(`Gateway returned ${res.status}`);
      const data = (await res.json()) as AgentResponse;
      setResponse(data);

      if (data.result?.audit_trace_id) {
        const auditRes = await fetch(`${gatewayBaseUrl}/audit/${data.result.audit_trace_id}`);
        if (auditRes.ok) setAudit((await auditRes.json()) as AuditRecord);
      }
      await refreshMcpSessions();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <section className="masthead">
        <div>
          <p className="eyebrow">Agent-Bridge</p>
          <h1>Enterprise Agent Gateway</h1>
        </div>
        <div className="status-strip">
          <a href="/agentic">Agentic Web</a>
          <span>Value streams :4101</span>
          <span>Gateway :4100</span>
          <span>Demo :4102</span>
        </div>
      </section>

      <section className="demo-thesis" aria-label="Demo goals">
        <article>
          <FileCode2 size={19} />
          <div>
            <strong>Configure enterprise capabilities</strong>
            <span>Existing APIs are published as versioned, policy-bound business contracts.</span>
          </div>
        </article>
        <article>
          <Layers3 size={19} />
          <div>
            <strong>Route intent intelligently</strong>
            <span>Guardrails, semantic routing, optional LLM adjudication, and fallback are visible per request.</span>
          </div>
        </article>
        <article>
          <PanelsTopLeft size={19} />
          <div>
            <strong>Render MCP App interactions</strong>
            <span>Charts, confirmation gates, denials, and routing outcomes become user-facing components.</span>
          </div>
        </article>
      </section>

      <section className="workspace">
        <form
          className="agent-console management-console"
          onSubmit={(event) => {
            event.preventDefault();
            void askAgent();
          }}
        >
          <div className="panel-title">
            <BrainCircuit size={20} />
            <span>Management Console</span>
          </div>

          <div className="ops-summary">
            <Metric label="Published" value={`${capabilities.length || 4} capabilities`} />
            <Metric label="Router" value="layered semantic" />
            <Metric label="MCP sessions" value={`${mcpSessions.length} recent`} />
            <Metric label="Audit" value={audit ? audit.requestId : "event-ready"} />
          </div>

          <div className="scenario-block">
            <div className="scenario-heading">
              <span>Replay monitored scenario</span>
              <p>{activeScenario.narrative}</p>
            </div>
            <ScenarioShowcase scenario={activeScenario} response={response} />
            <div className="scenario-grid">
              {scenarios.map((scenario) => (
                <button
                  key={scenario.id}
                  type="button"
                  onClick={() => applyScenario(scenario)}
                  className={activeScenarioId === scenario.id ? "sample-button active" : "sample-button"}
                >
                  {scenario.label}
                </button>
              ))}
            </div>
          </div>

          <div className="request-preview">
            <span>Agent-client request</span>
            <p>{activeScenario.prompt}</p>
          </div>

          <button className="run-button" type="submit" disabled={loading}>
            {loading ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
            <span>Run Monitored Scenario</span>
          </button>
          {error ? <p className="error">{error}</p> : null}
        </form>

        <section className="result-stage">
          <div className="capability-band">
            <div className="panel-title">
              <ClipboardList size={20} />
              <span>Capability Discovery</span>
            </div>
            <div className="capability-list">
              {capabilities.map((capability) => (
                <article
                  key={capability.id}
                  className={selectedCapability?.id === capability.id ? "capability active" : "capability"}
                >
                  <h2>{capability.name}</h2>
                  <p>{capability.description}</p>
                  <div className="capability-meta">
                    <span>{capability.version}</span>
                    <span>{capability.dataClassification}</span>
                    <span>{capability.routing.riskLevel} risk</span>
                  </div>
                  <div className="api-tags">
                    {capability.requiredApis.map((api) => (
                      <span key={api}>{api.replace(" API", "")}</span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
            {selectedCapability ? <CapabilityContract capability={selectedCapability} /> : null}
          </div>

          <div className="response-grid">
            <section className="response-main">
              <div className="panel-title">
                <BadgeCheck size={20} />
                <span>Agent-readable Result</span>
              </div>
              {response ? (
                <>
                  <p className="summary">{response.result?.summary ?? response.resolution.reasoning}</p>
                  <div className="metric-row">
                    <Metric label="Status" value={response.resolution.status ?? "resolved"} />
                    <Metric
                      label="Capability"
                      value={response.resolution.capabilityId?.replaceAll("_", " ") ?? "not selected"}
                    />
                    <Metric label="Resolver" value={response.resolution.resolver ?? "rules"} />
                    <Metric label="Confidence" value={`${Math.round(response.resolution.confidence * 100)}%`} />
                    <Metric label="Trace" value={response.result?.audit_trace_id ?? "not invoked"} />
                  </div>
                  {response.result ? <pre>{JSON.stringify(response.result, null, 2)}</pre> : <GovernanceOutcome response={response} />}
                </>
              ) : (
                <div className="empty-state">
                  <Network size={32} />
                  <p>Send a request to watch the gateway filter, route, and compose enterprise APIs.</p>
                </div>
              )}
            </section>

            <aside className="trace-panel">
              <div className="panel-title">
                <Filter size={20} />
                <span>Routing Pipeline</span>
              </div>
              <RouterArchitecture />
              {response?.resolution.routingTrace?.length ? (
                <RoutingTrace steps={response.resolution.routingTrace} />
              ) : (
                <p className="muted">Routing decisions appear after the gateway classifies a request.</p>
              )}
            </aside>
          </div>

          <div className="response-grid">
            <section className="trace-panel wide">
              <div className="panel-title">
                <GitBranch size={20} />
                <span>Composition Trace</span>
              </div>
              {audit ? (
                <>
                  <TraceGroup icon={<Database size={18} />} title="Source APIs" items={audit.sourceApis} />
                  <TraceGroup
                    icon={<ShieldCheck size={18} />}
                    title="Policy"
                    items={audit.policyChecks.map((check) => `${check.name}: ${check.status}`)}
                  />
                  <TraceGroup
                    icon={<GitBranch size={18} />}
                    title="Composition"
                    items={audit.compositionSteps.map((step) => `${step.name}: ${step.detail}`)}
                  />
                  <TraceGroup
                    icon={<Route size={18} />}
                    title="Invocation Events"
                    items={audit.events.map((event) => `${event.type}: ${event.summary}`)}
                  />
                </>
              ) : response ? (
                <TraceGroup
                  icon={<ShieldCheck size={18} />}
                  title="Gateway Decision"
                  items={[
                    response.resolution.reasoning,
                    ...(response.resolution.policyDecision
                      ? [`${response.resolution.policyDecision.name}: ${response.resolution.policyDecision.detail}`]
                      : []),
                    ...(response.resolution.questions ?? []),
                    ...(response.resolution.availableCapabilities?.map((id) => `Available: ${id.replaceAll("_", " ")}`) ?? [])
                  ]}
                />
              ) : (
                <p className="muted">Audit trace appears after the first gateway invocation.</p>
              )}
            </section>
          </div>

          <section className="trace-panel wide">
            <div className="panel-title">
              <Satellite size={20} />
              <span>MCP Conversation Monitor</span>
            </div>
            <McpSessionMonitor sessions={mcpSessions} />
          </section>
        </section>
      </section>
    </main>
  );
}

type AguiRunEvent = {
  id: string;
  type: string;
  label: string;
  detail: string;
  status: "queued" | "running" | "completed" | "blocked";
};

type AguiStreamEnvelope = AguiRunEvent & {
  timestamp?: string;
  runId?: string;
  state?: Record<string, unknown>;
  response?: AgentResponse;
};

type A2uiComponent =
  | {
      id: string;
      type: "decision";
      title: string;
      body: string;
      status: string;
      capability?: string;
      confidence: number;
    }
  | {
      id: string;
      type: "chart";
      title: string;
      unit: string;
      data: Array<{ label: string; value: number; tone: "green" | "blue" | "gold" | "red" }>;
    }
  | {
      id: string;
      type: "confirmation";
      title: string;
      body: string;
      actions: string[];
    }
  | {
      id: string;
      type: "boundary";
      title: string;
      body: string;
      items: string[];
    }
  | {
      id: string;
      type: "trace";
      title: string;
      items: string[];
    };

type A2uiSurface = {
  surfaceId: string;
  intent: string;
  components: A2uiComponent[];
};

function AgenticWebPage() {
  const [prompt, setPrompt] = useState("");
  const [activeQuestionId, setActiveQuestionId] = useState(agenticQuestions[0]?.id ?? "");
  const [response, setResponse] = useState<AgentResponse | null>(null);
  const [audit, setAudit] = useState<AuditRecord | null>(null);
  const [events, setEvents] = useState<AguiRunEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const selectedQuestion = agenticQuestions.find((question) => question.id === activeQuestionId) ?? agenticQuestions[0];
  const currentPrompt = prompt || selectedQuestion?.prompt || "";
  const surface = useMemo(() => buildA2uiSurface(response, audit), [response, audit]);
  const hasRun = Boolean(response || loading || error);

  function chooseQuestion(question: (typeof agenticQuestions)[number]) {
    setActiveQuestionId(question.id);
    setPrompt(question.prompt);
    setError("");
  }

  async function submitAgenticRequest(event?: React.FormEvent) {
    event?.preventDefault();
    const question = currentPrompt.trim();
    if (!question) return;

    const scenario = agenticQuestions.find((item) => item.prompt === question) ?? selectedQuestion;
    const scenarioDefinition = scenarios.find((item) => item.id === scenario?.id);
    setLoading(true);
    setError("");
    setAudit(null);
    setResponse(null);
    setEvents([]);

    try {
      const input = scenarioDefinition?.input ?? { customerId: "UK001" };
      const data = await runAguiRequest(
        {
          ...input,
          prompt: question
        },
        (streamEvent) => {
          setEvents((current) => [
            ...current,
            {
              id: streamEvent.id,
              type: streamEvent.type,
              label: streamEvent.label,
              detail: streamEvent.detail,
              status: streamEvent.status
            }
          ]);
        }
      );
      setResponse(data);

      const nextAudit = data.result?.audit_trace_id
        ? await fetch(`${gatewayBaseUrl}/audit/${data.result.audit_trace_id}`)
            .then((auditRes) => auditRes.ok ? auditRes.json() as Promise<AuditRecord> : null)
            .catch(() => null)
        : null;
      setAudit(nextAudit);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed");
      setEvents((current) => [
        ...current,
        {
          id: "run-error",
          type: "RUN_ERROR",
          label: "Run failed",
          detail: caught instanceof Error ? caught.message : "Request failed",
          status: "blocked"
        }
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={hasRun ? "agentic-shell engaged" : "agentic-shell"}>
      <section className="agentic-topbar">
        <a href="/" className="console-link">
          <PanelsTopLeft size={17} />
          <span>Management Console</span>
        </a>
        <div className="agentic-system">
          <span>AG-UI event loop</span>
          <span>A2UI surface renderer</span>
          <span>MCP-compatible gateway</span>
        </div>
      </section>

      <section className="agentic-layout">
        <aside className="agentic-assistant-panel">
          <div className="assistant-panel-head">
            <div>
              <span>Agentic Web</span>
              <strong>Financial capability agent</strong>
            </div>
            <SlidersHorizontal size={18} />
          </div>

          <form className="agentic-compose compact" onSubmit={(event) => void submitAgenticRequest(event)}>
            <label>
              <span>Ask through governed capabilities</span>
              <textarea
                value={currentPrompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Ask about ISA allowance, drawdown, workplace pension, adviser model portfolio, or governance boundaries."
              />
            </label>
            <button className="agentic-send" type="submit" disabled={loading || !currentPrompt.trim()}>
              {loading ? <Loader2 className="spin" size={18} /> : <SendHorizontal size={18} />}
              <span>Send</span>
            </button>
          </form>

          <div className="agentic-question-list">
            {agenticQuestions.map((question) => (
              <button
                key={question.id}
                type="button"
                className={question.id === activeQuestionId ? "agentic-question active" : "agentic-question"}
                onClick={() => chooseQuestion(question)}
              >
                <strong>{question.label}</strong>
                <span>{question.prompt}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="agentic-main">
          {!hasRun ? (
            <div className="agentic-start">
              <div className="agentic-brand-mark">
                <Search size={28} />
              </div>
              <h1>Ask the enterprise capability layer.</h1>
              <form className="agentic-compose hero-compose" onSubmit={(event) => void submitAgenticRequest(event)}>
                <textarea
                  value={currentPrompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Ask a governed financial question..."
                  aria-label="Agentic question"
                />
                <button className="agentic-send" type="submit" disabled={!currentPrompt.trim()}>
                  <SendHorizontal size={18} />
                  <span>Send</span>
                </button>
              </form>
              <div className="agentic-suggestions">
                {agenticQuestions.slice(0, 6).map((question) => (
                  <button key={question.id} type="button" onClick={() => chooseQuestion(question)}>
                    <strong>{question.label}</strong>
                    <span>{question.tags[1]}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="agentic-result-head">
                <div>
                  <span>A2UI surface</span>
                  <h1>{surface.intent}</h1>
                </div>
                <div className="surface-meta">
                  <span>{response?.resolution.status ?? (loading ? "running" : "error")}</span>
                  <span>{response?.resolution.capabilityId?.replaceAll("_", " ") ?? "no capability selected"}</span>
                </div>
              </div>

              {error ? (
                <section className="agentic-error">
                  <ShieldAlert size={24} />
                  <p>{error}</p>
                </section>
              ) : null}

              <A2uiSurfaceView surface={surface} loading={loading} />
            </>
          )}
        </section>

        <aside className="agentic-event-panel">
          <div className="assistant-panel-head">
            <div>
              <span>AG-UI stream</span>
              <strong>{events.length ? `${events.length} events` : "waiting"}</strong>
            </div>
            <MessageSquareText size={18} />
          </div>
          <div className="agui-event-list">
            {events.length ? (
              events.map((event) => (
                <article className={`agui-event ${event.status}`} key={event.id}>
                  <span>{event.type}</span>
                  <strong>{event.label}</strong>
                  <p>{event.detail}</p>
                </article>
              ))
            ) : (
              <p className="muted">Send a question to populate the event stream and mount the generated surface.</p>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}

async function runAguiRequest(
  body: Record<string, unknown>,
  onEvent: (event: AguiStreamEnvelope) => void
) {
  const res = await fetch(`${gatewayBaseUrl}/agui/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Gateway returned ${res.status}`);
  if (!res.body) throw new Error("Gateway did not return a stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResponse: AgentResponse | null = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const streamEvent = parseSseEvent(chunk);
      if (!streamEvent) continue;
      onEvent(streamEvent);
      if (streamEvent.response) finalResponse = streamEvent.response;
    }
  }

  const tail = buffer.trim();
  if (tail) {
    const streamEvent = parseSseEvent(tail);
    if (streamEvent) {
      onEvent(streamEvent);
      if (streamEvent.response) finalResponse = streamEvent.response;
    }
  }

  if (!finalResponse) throw new Error("AG-UI run ended without a final response");
  return finalResponse;
}

function parseSseEvent(chunk: string): AguiStreamEnvelope | null {
  const eventType = chunk
    .split("\n")
    .find((line) => line.startsWith("event:"))
    ?.slice("event:".length)
    .trim();
  const data = chunk
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .join("\n");
  if (!data) return null;
  const parsed = JSON.parse(data) as Partial<AguiStreamEnvelope>;
  return {
    id: parsed.id ?? `${eventType ?? "EVENT"}-${Date.now()}`,
    type: parsed.type ?? eventType ?? "EVENT",
    label: parsed.label ?? eventType ?? "Event",
    detail: parsed.detail ?? "",
    status: parsed.status ?? "completed",
    timestamp: parsed.timestamp,
    runId: parsed.runId,
    state: parsed.state,
    response: parsed.response
  };
}

function buildA2uiSurface(response: AgentResponse | null, audit: AuditRecord | null): A2uiSurface {
  if (!response) {
    return {
      surfaceId: "agentic-empty",
      intent: "Preparing governed surface",
      components: [
        {
          id: "empty",
          type: "boundary",
          title: "Waiting for intent",
          body: "The first response will determine whether the page renders a chart, confirmation gate, policy boundary, or multi-panel capability result.",
          items: ["AG-UI event stream", "Gateway result", "A2UI surface renderer"]
        }
      ]
    };
  }

  const result = response.result ?? {};
  const status = response.resolution.status ?? "resolved";
  const components: A2uiComponent[] = [
    {
      id: "decision",
      type: "decision",
      title: status === "resolved" ? "Governed answer" : status.replaceAll("_", " "),
      body: result.summary ?? response.resolution.reasoning,
      status,
      capability: response.resolution.capabilityId,
      confidence: response.resolution.confidence
    }
  ];

  const chart = chartFromResponse(response);
  if (chart) components.push(chart);

  const policyItems = [
    ...(result.policy_checks?.map((check) => `${check.name}: ${check.status}`) ?? []),
    ...(response.resolution.policyDecision
      ? [`${response.resolution.policyDecision.name}: ${response.resolution.policyDecision.status}`]
      : [])
  ];
  if (status === "denied" || status === "unsupported" || status === "needs_clarification") {
    components.push({
      id: "boundary",
      type: "boundary",
      title: status === "needs_clarification" ? "Clarification needed" : "Capability boundary",
      body: response.resolution.reasoning,
      items: [
        ...(response.resolution.questions ?? []),
        ...(response.resolution.availableCapabilities?.map((id) => id.replaceAll("_", " ")) ?? []),
        ...policyItems
      ]
    });
  } else if (policyItems.some((item) => item.includes("requires_confirmation"))) {
    components.push({
      id: "confirmation",
      type: "confirmation",
      title: "Human confirmation gate",
      body: "The result can be explained, but execution-oriented next actions remain gated by policy.",
      actions: result.next_actions?.map((action) => String(action.label ?? action.type ?? action.action ?? "Review next action")) ?? [
        "Review recommendation",
        "Confirm with customer"
      ]
    });
  }

  components.push({
    id: "trace",
    type: "trace",
    title: "Provenance",
    items: [
      ...(result.source_apis ?? []),
      ...(audit?.compositionSteps.map((step) => `${step.name}: ${step.status}`) ?? []),
      ...(result.audit_trace_id ? [`audit: ${result.audit_trace_id}`] : [])
    ]
  });

  return {
    surfaceId: "agentic-result",
    intent: response.resolution.capabilityId?.replaceAll("_", " ") ?? response.resolution.intent ?? status,
    components
  };
}

function chartFromResponse(response: AgentResponse): A2uiComponent | null {
  const result = response.result ?? {};
  const directChart = result.chart as DemoScenario["chart"] | undefined;
  if (directChart) {
    return {
      id: "chart",
      type: "chart",
      title: directChart.title,
      unit: directChart.unit,
      data: directChart.data
    };
  }

  const planned = readCurrencyValue(result, ["planned_subscription_check", "planned_subscription"]);
  const remaining = readCurrencyValue(result, ["allowance", "remaining_allowance"]) ?? readCurrencyValue(result, ["isa_allowance", "remaining_allowance"]);
  const used = readCurrencyValue(result, ["allowance", "used_allowance"]) ?? readCurrencyValue(result, ["isa_allowance", "used_allowance"]);
  if (planned || remaining || used) {
    return {
      id: "chart",
      type: "chart",
      title: "ISA allowance composition",
      unit: "GBP",
      data: [
        { label: "Used", value: used ?? 0, tone: "blue" },
        { label: "Planned", value: planned ?? 0, tone: "green" },
        { label: "Remaining", value: remaining ?? 0, tone: "gold" }
      ]
    };
  }

  const projection = result.projection && typeof result.projection === "object" ? result.projection as Record<string, unknown> : null;
  if (projection) {
    return {
      id: "chart",
      type: "chart",
      title: "Projected pension outcome",
      unit: "GBP",
      data: Object.entries(projection)
        .filter(([, value]) => typeof value === "number")
        .slice(0, 4)
        .map(([label, value], index) => ({
          label: label.replaceAll("_", " "),
          value: Number(value),
          tone: (["green", "blue", "gold", "red"] as const)[index]
        }))
    };
  }

  return null;
}

function readCurrencyValue(source: Record<string, unknown>, path: string[]) {
  let current: unknown = source;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  if (typeof current === "number") return current;
  if (typeof current !== "string") return undefined;
  const value = Number(current.replace(/[^\d.-]/g, ""));
  return Number.isFinite(value) ? value : undefined;
}

function A2uiSurfaceView({ surface, loading }: { surface: A2uiSurface; loading: boolean }) {
  return (
    <div className="a2ui-surface" aria-label={surface.surfaceId}>
      {loading ? (
        <section className="a2ui-loading">
          <Loader2 className="spin" size={24} />
          <p>Composing governed UI from intent, policy, source APIs, and result shape.</p>
        </section>
      ) : null}
      {surface.components.map((component) => (
        <A2uiComponentView component={component} key={component.id} />
      ))}
    </div>
  );
}

function A2uiComponentView({ component }: { component: A2uiComponent }) {
  if (component.type === "decision") {
    return (
      <section className={`a2ui-card decision ${component.status}`}>
        <div className="a2ui-card-icon">
          <Landmark size={22} />
        </div>
        <div>
          <span>{component.status}</span>
          <h2>{component.title}</h2>
          <p>{component.body}</p>
          <div className="a2ui-pills">
            <span>{component.capability?.replaceAll("_", " ") ?? "capability not selected"}</span>
            <span>{Math.round(component.confidence * 100)}% confidence</span>
          </div>
        </div>
      </section>
    );
  }

  if (component.type === "chart") {
    const max = Math.max(...component.data.map((item) => item.value), 1);
    return (
      <section className="a2ui-card chart">
        <div className="a2ui-card-title">
          <BarChart3 size={20} />
          <h2>{component.title}</h2>
        </div>
        <div className="a2ui-chart-bars">
          {component.data.map((item) => (
            <div className="a2ui-chart-row" key={item.label}>
              <span>{item.label}</span>
              <div>
                <i className={`tone-${item.tone}`} style={{ width: `${Math.max(4, (item.value / max) * 100)}%` }} />
              </div>
              <strong>{formatMetricValue(item.value, component.unit)}</strong>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (component.type === "confirmation") {
    return (
      <section className="a2ui-card confirmation">
        <div className="a2ui-card-title">
          <ShieldCheck size={20} />
          <h2>{component.title}</h2>
        </div>
        <p>{component.body}</p>
        <div className="confirmation-actions">
          {component.actions.map((action) => (
            <button type="button" key={action}>
              <CheckCircle2 size={16} />
              <span>{action}</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  if (component.type === "boundary") {
    return (
      <section className="a2ui-card boundary">
        <div className="a2ui-card-title">
          <ShieldAlert size={20} />
          <h2>{component.title}</h2>
        </div>
        <p>{component.body}</p>
        <ul>
          {component.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section className="a2ui-card trace">
      <div className="a2ui-card-title">
        <Gauge size={20} />
        <h2>{component.title}</h2>
      </div>
      <div className="trace-chip-list">
        {component.items.length ? component.items.map((item) => <span key={item}>{item}</span>) : <span>No source trace emitted.</span>}
      </div>
    </section>
  );
}

function formatMetricValue(value: number, unit: string) {
  if (unit.toLowerCase().includes("gbp")) {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value);
  }
  return `${value}${unit === "%" ? "%" : ` ${unit}`}`;
}

function McpSessionMonitor({ sessions }: { sessions: McpConversationSession[] }) {
  if (!sessions.length) {
    return (
      <div className="empty-monitor">
        <Satellite size={28} />
        <p>MCP client activity will appear here after Copilot, Claude Code, or the smoke client calls Agent-Bridge tools.</p>
      </div>
    );
  }

  return (
    <div className="mcp-session-list">
      {sessions.map((session) => (
        <article className="mcp-session" key={session.id}>
          <div className="mcp-session-head">
            <div>
              <span>{session.clientName}</span>
              <h3>{session.id}</h3>
            </div>
            <strong>{session.stepCount} steps</strong>
          </div>
          <p>{session.lastSummary}</p>
          <div className="mcp-tags">
            {session.capabilityIds.map((id) => (
              <span key={id}>{id.replaceAll("_", " ")}</span>
            ))}
            {session.traceIds.map((id) => (
              <span key={id}>{id}</span>
            ))}
          </div>
          <div className="mcp-timeline">
            {session.steps.map((step) => (
              <div className={`mcp-step ${step.status}`} key={step.id}>
                <span>{step.sequence}</span>
                <div>
                  <strong>{step.kind.replaceAll(".", " ")} · {step.name}</strong>
                  <p>{step.summary}</p>
                  <em>{step.actor} · {new Date(step.timestamp).toLocaleTimeString()}</em>
                </div>
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function CapabilityContract({ capability }: { capability: Capability }) {
  return (
    <section className="contract-panel" aria-label="Capability contract">
      <div className="contract-head">
        <div>
          <span>Enterprise capability contract</span>
          <h3>{capability.id}</h3>
        </div>
        <strong>{capability.status}</strong>
      </div>
      <p>{capability.businessOutcome}</p>
      <div className="contract-grid">
        <MiniSpec title="Owner" value={capability.owner} />
        <MiniSpec title="Version" value={capability.version} />
        <MiniSpec title="Access" value={capability.policy.dataAccess} />
        <MiniSpec title="Confirmation" value={capability.policy.requiresCustomerConfirmation ? "required" : "not required"} />
      </div>
      <div className="contract-columns">
        <TraceGroup
          icon={<Database size={18} />}
          title="Composed APIs"
          items={capability.requiredApis}
        />
        <TraceGroup
          icon={<FileCode2 size={18} />}
          title="Configured Inputs"
          items={Object.entries(capability.inputSchema).map(([key, value]) => `${key}: ${String(value)}`)}
        />
      </div>
      <div className="execution-plan">
        {capability.executionPlan.steps.map((step, index) => (
          <article key={step.id}>
            <span>{index + 1}</span>
            <div>
              <strong>{step.id.replaceAll("_", " ")}</strong>
              <p>{step.uses ? `${step.uses}. ${step.description}` : step.description}</p>
            </div>
            <em>{step.type.replaceAll("_", " ")}</em>
          </article>
        ))}
      </div>
    </section>
  );
}

function MiniSpec({ title, value }: { title: string; value: string }) {
  return (
    <div className="mini-spec">
      <span>{title}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RouterArchitecture() {
  const layers = [
    ["Policy guard", "PII and scope boundaries"],
    ["Rules guard", "Deterministic safety conflicts"],
    ["Semantic router", "Catalog vectors and examples"],
    ["LLM adjudicator", "Only ambiguous top-K"],
    ["Fallback", "Clarify or refuse safely"]
  ];

  return (
    <div className="router-architecture">
      {layers.map(([title, detail], index) => (
        <div key={title}>
          <span>{index + 1}</span>
          <strong>{title}</strong>
          <em>{detail}</em>
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ScenarioShowcase({ scenario, response }: { scenario: DemoScenario; response: AgentResponse | null }) {
  const sourceCount = response?.result?.source_apis?.length ?? 0;
  const policyCount = response?.result?.policy_checks?.length ?? 0;
  const confidence = response?.resolution.confidence ?? 0;
  const denied = response?.resolution.status === "denied" || scenario.expectedStatus === "denied";

  const icon =
    scenario.interactionPattern === "chart" ? (
      <BarChart3 size={17} />
    ) : scenario.interactionPattern === "confirmation" ? (
      <CheckCircle2 size={17} />
    ) : scenario.interactionPattern === "policy" ? (
      <LockKeyhole size={17} />
    ) : (
      <PanelsTopLeft size={17} />
    );

  return (
    <div className="scenario-showcase">
      <div className="showcase-head">
        {icon}
        <span>{scenario.interactionPattern.replaceAll("-", " ")} components</span>
      </div>
      <div className="showcase-bars" aria-label="Scenario component preview">
        <PreviewBar label="Confidence" value={Math.max(8, confidence * 100)} tone="green" detail={confidence ? `${Math.round(confidence * 100)}%` : "pending"} />
        <PreviewBar label="Sources" value={Math.min(100, Math.max(14, sourceCount * 18))} tone="blue" detail={sourceCount ? String(sourceCount) : "pending"} />
        <PreviewBar label="Policy" value={Math.min(100, Math.max(18, policyCount * 24))} tone="gold" detail={policyCount ? String(policyCount) : scenario.components.includes("confirmation_gate") ? "gate" : "ready"} />
        <PreviewBar label="Denial" value={denied ? 88 : 10} tone="red" detail={denied ? "armed" : "clear"} />
      </div>
      <div className="component-tags">
        {scenario.components.map((component) => (
          <span key={component}>{component.replaceAll("_", " ")}</span>
        ))}
      </div>
    </div>
  );
}

function PreviewBar({
  label,
  value,
  tone,
  detail
}: {
  label: string;
  value: number;
  tone: "green" | "blue" | "gold" | "red";
  detail: string;
}) {
  return (
    <div className="preview-bar">
      <span>{label}</span>
      <div className="preview-track">
        <div className={`preview-fill ${tone}`} style={{ width: `${value}%` }} />
      </div>
      <strong>{detail}</strong>
    </div>
  );
}

function GovernanceOutcome({ response }: { response: AgentResponse }) {
  return (
    <div className="governance-outcome">
      {response.resolution.policyDecision ? (
        <div>
          <span className="outcome-label">{response.resolution.policyDecision.name}</span>
          <p>{response.resolution.policyDecision.detail}</p>
        </div>
      ) : null}
      {response.resolution.questions?.length ? (
        <div>
          <span className="outcome-label">Clarifying questions</span>
          <ul>
            {response.resolution.questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {response.resolution.availableCapabilities?.length ? (
        <div>
          <span className="outcome-label">Published capabilities</span>
          <ul>
            {response.resolution.availableCapabilities.map((capability) => (
              <li key={capability}>{capability.replaceAll("_", " ")}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <pre>{JSON.stringify(response.resolution, null, 2)}</pre>
    </div>
  );
}

function RoutingTrace({ steps }: { steps: NonNullable<AgentResponse["resolution"]["routingTrace"]> }) {
  return (
    <div className="routing-steps">
      {steps.map((step, index) => (
        <article className={`routing-step ${step.status}`} key={`${step.layer}-${index}`}>
          <div className="routing-step-head">
            <span>{step.layer.replaceAll("_", " ")}</span>
            <strong>{step.status.replaceAll("_", " ")}</strong>
          </div>
          <p>{step.detail}</p>
          <div className="routing-meta">
            {step.capabilityId ? <span>{step.capabilityId.replaceAll("_", " ")}</span> : null}
            {typeof step.confidence === "number" ? <span>{Math.round(step.confidence * 100)}%</span> : null}
          </div>
          {step.candidates?.length ? (
            <div className="candidate-list">
              {step.candidates.map((candidate) => (
                <div className="candidate" key={candidate.capabilityId}>
                  <span>{candidate.capabilityId.replaceAll("_", " ")}</span>
                  <strong>{candidate.score.toFixed(2)}</strong>
                  {candidate.matchedTerms?.length ? <em>{candidate.matchedTerms.join(", ")}</em> : null}
                </div>
              ))}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function TraceGroup({ icon, title, items }: { icon: React.ReactNode; title: string; items: string[] }) {
  return (
    <div className="trace-group">
      <h3>
        {icon}
        <span>{title}</span>
      </h3>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  window.location.pathname.startsWith("/agentic") ? <AgenticWebPage /> : <App />
);
