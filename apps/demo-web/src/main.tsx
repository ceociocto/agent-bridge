import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BadgeCheck,
  BrainCircuit,
  ClipboardList,
  Database,
  GitBranch,
  Loader2,
  Network,
  Play,
  ShieldCheck
} from "lucide-react";
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
    capabilityId: string;
    confidence: number;
    reasoning: string;
    resolver?: "llm" | "rules";
  };
  capability: Capability;
  result: Record<string, unknown> & {
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

const prompts = [
  "Can this client retire at age 60 based on current assets and projected income?",
  "Should I increase my retirement contribution this year?",
  "What contribution change would improve my retirement outcome without exceeding limits?"
];

function App() {
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [prompt, setPrompt] = useState(prompts[0]);
  const [customerId, setCustomerId] = useState("C001");
  const [targetAge, setTargetAge] = useState(60);
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

  async function askAgent() {
    setLoading(true);
    setError("");
    setAudit(null);
    try {
      const res = await fetch(`${gatewayBaseUrl}/agent/request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          customerId,
          targetRetirementAge: targetAge
        })
      });
      if (!res.ok) throw new Error(`Gateway returned ${res.status}`);
      const data = (await res.json()) as AgentResponse;
      setResponse(data);

      if (data.result.audit_trace_id) {
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
          <span>Mock APIs :4101</span>
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
              <option value="C001">C001 - Jerry Li</option>
              <option value="C002">C002 - Seajay Pei</option>
            </select>
          </label>

          <label>
            <span>Agent request</span>
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={5} />
          </label>

          <div className="prompt-row">
            {prompts.map((sample) => (
              <button key={sample} type="button" onClick={() => setPrompt(sample)} className="sample-button">
                {sample.includes("contribution") ? "Contribution" : "Readiness"}
              </button>
            ))}
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
            <span>Ask Platform</span>
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
                  <p className="summary">{response.result.summary}</p>
                  <div className="metric-row">
                    <Metric label="Capability" value={response.resolution.capabilityId.replaceAll("_", " ")} />
                    <Metric label="Resolver" value={response.resolution.resolver ?? "rules"} />
                    <Metric label="Confidence" value={`${Math.round(response.resolution.confidence * 100)}%`} />
                    <Metric label="Trace" value={response.result.audit_trace_id ?? "pending"} />
                  </div>
                  <pre>{JSON.stringify(response.result, null, 2)}</pre>
                </>
              ) : (
                <div className="empty-state">
                  <Network size={32} />
                  <p>Send a request to watch the gateway resolve intent and compose enterprise APIs.</p>
                </div>
              )}
            </section>

            <aside className="trace-panel">
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
              ) : (
                <p className="muted">Audit trace appears after the first gateway invocation.</p>
              )}
            </aside>
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
