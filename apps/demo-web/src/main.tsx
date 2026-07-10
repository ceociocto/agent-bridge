import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BadgeCheck,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  ClipboardList,
  Database,
  Filter,
  GitBranch,
  Loader2,
  LockKeyhole,
  Network,
  PanelsTopLeft,
  Play,
  ShieldCheck
} from "lucide-react";
import { demoScenarios, type DemoScenario } from "@agent-bridge/shared";
import "./styles.css";

const gatewayBaseUrl = import.meta.env.VITE_GATEWAY_URL ?? "http://localhost:4100";

type Capability = {
  id: string;
  name: string;
  description: string;
  businessOutcome: string;
  requiredApis: string[];
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
  sourceApis: string[];
  policyChecks: Array<{ name: string; status: string; detail: string }>;
  compositionSteps: Array<{ name: string; status: string; detail: string }>;
};

const scenarios = demoScenarios;

function App() {
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [activeScenarioId, setActiveScenarioId] = useState(scenarios[0].id);
  const [prompt, setPrompt] = useState(scenarios[0].prompt);
  const [customerId, setCustomerId] = useState(scenarios[0].customerId);
  const [targetAge, setTargetAge] = useState(scenarios[0].input.targetRetirementAge ?? 62);
  const [response, setResponse] = useState<AgentResponse | null>(null);
  const [audit, setAudit] = useState<AuditRecord | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${gatewayBaseUrl}/capabilities`)
      .then((res) => res.json())
      .then((data) => setCapabilities(data.capabilities ?? []))
      .catch(() => setError("Gateway is not reachable. Start the POC services with pnpm dev."));
  }, []);

  const selectedCapability = useMemo(() => response?.capability ?? capabilities[0], [capabilities, response]);
  const activeScenario = scenarios.find((scenario) => scenario.id === activeScenarioId) ?? scenarios[0];

  function applyScenario(scenario: DemoScenario) {
    setActiveScenarioId(scenario.id);
    setPrompt(scenario.prompt);
    setCustomerId(scenario.customerId);
    setTargetAge(scenario.input.targetRetirementAge ?? 62);
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
          prompt,
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
          prompt,
          customerId,
          targetRetirementAge: targetAge
        })
      });
      if (!res.ok) throw new Error(`Gateway returned ${res.status}`);
      const data = (await res.json()) as AgentResponse;
      setResponse(data);

      if (data.result?.audit_trace_id) {
        const auditRes = await fetch(`${gatewayBaseUrl}/audit/${data.result.audit_trace_id}`);
        if (auditRes.ok) setAudit((await auditRes.json()) as AuditRecord);
      }
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
          <h1>AI Gateway POC</h1>
        </div>
        <div className="status-strip">
          <span>Value streams :4101</span>
          <span>Gateway :4100</span>
          <span>Demo :4102</span>
        </div>
      </section>

      <section className="workspace">
        <form
          className="agent-console"
          onSubmit={(event) => {
            event.preventDefault();
            void askAgent();
          }}
        >
          <div className="panel-title">
            <BrainCircuit size={20} />
            <span>User Agent</span>
          </div>

          <label>
            <span>Customer</span>
            <select value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
              <option value="UK001">UK001 - Amelia Clarke</option>
              <option value="UK002">UK002 - Martin Hughes</option>
              <option value="UK003">UK003 - Priya Shah</option>
            </select>
          </label>

          <label>
            <span>Agent request</span>
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={5} />
          </label>

          <div className="scenario-block">
            <div className="scenario-heading">
              <span>{activeScenario.title}</span>
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

          <label>
            <span>Target retirement age</span>
            <input
              type="number"
              min={50}
              max={75}
              value={targetAge}
              onChange={(event) => setTargetAge(Number(event.target.value))}
            />
          </label>

          <button className="run-button" type="submit" disabled={loading}>
            {loading ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
            <span>Ask Agent Bridge</span>
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
                  <div className="api-tags">
                    {capability.requiredApis.map((api) => (
                      <span key={api}>{api.replace(" API", "")}</span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
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
        </section>
      </section>
    </main>
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

createRoot(document.getElementById("root")!).render(<App />);
