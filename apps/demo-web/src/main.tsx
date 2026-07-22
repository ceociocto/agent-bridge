import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BadgeCheck,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
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
import {
  demoScenarios,
  type DemoScenario,
  type MicroWorkflowId,
  type WorkflowActionType,
  type WorkflowRun,
  type WorkflowUiHint
} from "@agent-bridge/shared";
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
  workflowRun?: WorkflowRun;
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

type AgenticWorkflow = {
  id: string;
  domain: "Personal Investing" | "Workplace Investing";
  audience: "Client" | "Adviser" | "Member";
  label: string;
  title: string;
  prompt: string;
  capabilityId?: string;
  input: Record<string, unknown>;
  pattern: "interactive-report" | "advisor-pack" | "guided-simulation" | "transfer-triage";
  microWorkflow: MicroWorkflowId;
  apiPlan: string[];
  runtime: Array<"long-task" | "durable" | "retry" | "queue" | "human-loop">;
  components: string[];
  narrative: string;
  steps: Array<{ label: string; detail: string }>;
};

const agenticWorkflows: AgenticWorkflow[] = [
  {
    id: "isa-top-up-readiness",
    domain: "Personal Investing",
    audience: "Client",
    label: "ISA top-up",
    title: "ISA top-up readiness",
    prompt: "Can I add £8,000 to my Fidelity Stocks and Shares ISA this tax year?",
    capabilityId: "personal_investing_isa_allowance_review",
    input: { customerId: "UK001", plannedIsaSubscription: 8000, isaWorkflowId: "isa_subscription_feasibility" },
    pattern: "interactive-report",
    microWorkflow: "isa_subscription_feasibility",
    apiPlan: ["Profile", "Accounts", "ISA subscriptions", "Cash balance", "Policy audit"],
    runtime: ["durable", "human-loop"],
    components: ["allowance report", "top-up slider", "funding source", "confirmation gate"],
    narrative: "A retail client gets a generated ISA allowance page and can adjust the top-up amount before confirmation.",
    steps: [
      { label: "Review allowance", detail: "Check this tax year's available ISA allowance." },
      { label: "Choose amount", detail: "Adjust the top-up and see the remaining allowance." },
      { label: "Confirm top-up", detail: "Review and explicitly approve the instruction." }
    ]
  },
  {
    id: "advisor-review-pack",
    domain: "Personal Investing",
    audience: "Adviser",
    label: "Review pack",
    title: "Adviser portfolio review pack",
    prompt: "Prepare a model portfolio drift review for this advised client on the adviser platform.",
    capabilityId: "adviser_platform_model_portfolio_review",
    input: { customerId: "UK003", adviserFirmId: "FA-100", riskProfile: "balanced" },
    pattern: "advisor-pack",
    microWorkflow: "adviser_review_pack_generation",
    apiPlan: ["Adviser entitlement", "Client profile", "Platform accounts", "Model portfolio", "Holdings", "Evidence pack"],
    runtime: ["long-task", "queue", "retry", "human-loop", "durable"],
    components: ["client queue", "drift report", "evidence pack", "compliance sign-off"],
    narrative: "A 2B adviser starts a long-running evidence pack with queueing, retry, and compliance review.",
    steps: [
      { label: "Start pack", detail: "Place the client pack into the durable work queue." },
      { label: "Review drift", detail: "Inspect portfolio drift and evidence completeness." },
      { label: "Resolve exception", detail: "Retry the incomplete projection without restarting." },
      { label: "Sign off", detail: "Approve the evidence pack for the client record." }
    ]
  },
  {
    id: "retirement-gap",
    domain: "Workplace Investing",
    audience: "Member",
    label: "Goal gap",
    title: "Retirement goal gap review",
    prompt: "Am I on track to retire at 65, and what contribution change would close the gap?",
    capabilityId: "workplace_pension_contribution_guidance",
    input: { customerId: "UK003", desiredContributionRate: 12, targetRetirementAge: 65 },
    pattern: "guided-simulation",
    microWorkflow: "retirement_goal_gap_projection",
    apiPlan: ["Member profile", "Pension balance", "Contribution schedule", "Projection", "Target income", "Policy audit"],
    runtime: ["long-task", "durable", "retry"],
    components: ["goal gap meter", "age stepper", "contribution slider", "scenario comparison"],
    narrative: "A longer projection task can be resumed and retried while the user adjusts goal assumptions.",
    steps: [
      { label: "Set goal", detail: "Choose retirement age and contribution assumptions." },
      { label: "Run projection", detail: "Continue a durable long-running forecast." },
      { label: "Compare plan", detail: "Review the adjusted scenario against the current path." }
    ]
  }
];

const workflowById = new Map(agenticWorkflows.map((workflow) => [workflow.id, workflow]));

function AgenticWebPage() {
  const [activeWorkflowId, setActiveWorkflowId] = useState(() => {
    const saved = window.localStorage.getItem("agentic.activeWorkflowId");
    return saved && workflowById.has(saved) ? saved : agenticWorkflows[0].id;
  });
  const activeWorkflow = workflowById.get(activeWorkflowId) ?? agenticWorkflows[0];
  const [renderedWorkflowId, setRenderedWorkflowId] = useState(activeWorkflow.id);
  const renderedWorkflow = workflowById.get(renderedWorkflowId) ?? agenticWorkflows[0];
  const [prompt, setPrompt] = useState(() => window.localStorage.getItem("agentic.prompt") || activeWorkflow.prompt);
  const assistantTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [response, setResponse] = useState<AgentResponse | null>(null);
  const [audit, setAudit] = useState<AuditRecord | null>(null);
  const [events, setEvents] = useState<AguiRunEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [workflowActionLoading, setWorkflowActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [workspaceStarted, setWorkspaceStarted] = useState(false);
  const [workflowRun, setWorkflowRun] = useState<WorkflowRun | null>(null);
  const [subscriptionAmount, setSubscriptionAmount] = useState(8000);
  const [contributionRate, setContributionRate] = useState(10);
  const [retirementAge, setRetirementAge] = useState(65);

  const currentPrompt = prompt || activeWorkflow.prompt;
  const hasRun = workspaceStarted || Boolean(response || loading || error);
  useEffect(() => {
    window.scrollTo({ left: 0, top: window.scrollY });
  }, []);

  useEffect(() => {
    window.localStorage.setItem("agentic.activeWorkflowId", activeWorkflowId);
    window.localStorage.setItem("agentic.prompt", currentPrompt);
  }, [activeWorkflowId, currentPrompt]);

  useEffect(() => {
    setPrompt(activeWorkflow.prompt);
  }, [activeWorkflow]);

  function chooseWorkflow(workflow: AgenticWorkflow) {
    setActiveWorkflowId(workflow.id);
    if (hasRun) {
      window.requestAnimationFrame(() => assistantTextareaRef.current?.focus());
    }
  }

  async function submitAgenticRequest(event?: React.FormEvent) {
    event?.preventDefault();
    const question = currentPrompt.trim();
    if (!question) return;

    const desiredContribution = Number(activeWorkflow.input.desiredContributionRate ?? 10);
    const desiredRetirementAge = Number(activeWorkflow.input.targetRetirementAge ?? 65);
    const isRerunOfCurrentWorkflow = workspaceStarted && activeWorkflow.id === renderedWorkflowId;
    const submittedContribution = isRerunOfCurrentWorkflow ? contributionRate : desiredContribution;
    const submittedRetirementAge = isRerunOfCurrentWorkflow ? retirementAge : desiredRetirementAge;
    setRenderedWorkflowId(activeWorkflow.id);
    setWorkspaceStarted(true);
    setWorkflowRun(null);
    if (activeWorkflow.id === "isa-top-up-readiness") setSubscriptionAmount(8000);
    if (activeWorkflow.domain === "Workplace Investing") {
      setContributionRate(Number.isFinite(desiredContribution) ? desiredContribution : 10);
      setRetirementAge(Number.isFinite(desiredRetirementAge) ? desiredRetirementAge : 65);
    }
    setLoading(true);
    setError("");
    setAudit(null);
    setResponse(null);
    setEvents([]);

    try {
      const input = {
        ...activeWorkflow.input,
        microWorkflowId: activeWorkflow.microWorkflow,
        ...(activeWorkflow.id === "isa-top-up-readiness" ? { plannedIsaSubscription: subscriptionAmount } : {}),
        ...(activeWorkflow.domain === "Workplace Investing" ? {
          desiredContributionRate: submittedContribution,
          targetRetirementAge: submittedRetirementAge
        } : {})
      };
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
      setWorkflowRun(data.workflowRun ?? null);

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

  async function performWorkflowAction(
    action: WorkflowActionType,
    payload?: Record<string, unknown>
  ) {
    if (!workflowRun) return;
    const currentStep = workflowRun.steps[workflowRun.currentStepIndex];
    if (!currentStep) return;

    setWorkflowActionLoading(true);
    setError("");
    try {
      const actionResponse = await fetch(`${gatewayBaseUrl}/workflow-runs/${workflowRun.id}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, stepId: currentStep.id, payload })
      });
      if (!actionResponse.ok) {
        const detail = await actionResponse.json().catch(() => null) as { error?: string } | null;
        throw new Error(detail?.error ?? `Workflow action failed with ${actionResponse.status}`);
      }
      const nextRun = await actionResponse.json() as WorkflowRun;
      setWorkflowRun(nextRun);
      setResponse((current) => current ? { ...current, result: nextRun.result } : current);
      if (nextRun.auditTraceId !== audit?.traceId) {
        const nextAudit = await fetch(`${gatewayBaseUrl}/audit/${nextRun.auditTraceId}`)
          .then((auditResponse) => auditResponse.ok ? auditResponse.json() as Promise<AuditRecord> : null)
          .catch(() => null);
        setAudit(nextAudit);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Workflow action failed");
    } finally {
      setWorkflowActionLoading(false);
    }
  }

  const hasIntentBoundary = Boolean(
    response?.resolution.status && response.resolution.status !== "resolved"
  );

  return (
    <main className={hasRun ? "agentic-shell engaged" : "agentic-shell"}>
      <section className="agentic-topbar">
        <a href="/" className="console-link">
          <PanelsTopLeft size={17} />
          <span>Agentic Web</span>
        </a>
        <div className="agentic-system">
          <span className="live-chip">Client/adviser experience</span>
          <span>Dynamic A2UI page</span>
          <span>AG-UI runtime hidden</span>
          <span>Durable workflow demo</span>
        </div>
      </section>

      <section className="agentic-layout">
        <aside className="agentic-assistant-panel">
          <div className="assistant-panel-head">
            <div>
              <span>Business scenarios</span>
              <strong>Choose a user journey</strong>
            </div>
            <SlidersHorizontal size={18} />
          </div>

          <ScenarioModeStrip activeWorkflow={activeWorkflow} />

          <form className="agentic-compose compact" onSubmit={(event) => void submitAgenticRequest(event)}>
            <label>
              <span>Customer or adviser asks</span>
              <textarea
                ref={assistantTextareaRef}
                value={currentPrompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Ask a financial business question..."
              />
            </label>
            <button className="agentic-send" type="submit" disabled={loading || !currentPrompt.trim()}>
              {loading ? <Loader2 className="spin" size={18} /> : <SendHorizontal size={18} />}
              <span>Generate workspace</span>
            </button>
          </form>

          <div className="agentic-question-list">
            {agenticWorkflows.map((workflow) => (
              <button
                key={workflow.id}
                type="button"
                className={workflow.id === activeWorkflowId ? "agentic-question active" : "agentic-question"}
                onClick={() => chooseWorkflow(workflow)}
              >
                <strong>{workflow.label}</strong>
                <span>{workflow.narrative}</span>
                <small>{workflow.domain} / {workflow.audience}</small>
              </button>
            ))}
          </div>
        </aside>

        <section className="agentic-main">
          {!hasRun ? (
            <div className="agentic-start">
              <div className="agentic-orbit" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div className="agentic-brand-mark">
                <Search size={28} />
              </div>
              <p className="agentic-kicker">Natural language in. Business workspace out.</p>
              <h1>Generate the next financial workflow.</h1>
              <form className="agentic-compose hero-compose" onSubmit={(event) => void submitAgenticRequest(event)}>
                <textarea
                  value={currentPrompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Ask as a client, member, or adviser..."
                  aria-label="Agentic question"
                />
                <button className="agentic-send" type="submit" disabled={!currentPrompt.trim()}>
                  <SendHorizontal size={18} />
                  <span>Generate</span>
                </button>
              </form>
              <div className="agentic-suggestions">
                {agenticWorkflows.map((workflow) => (
                  <button key={workflow.id} type="button" onClick={() => chooseWorkflow(workflow)}>
                    <strong>{workflow.label}</strong>
                    <span>{workflow.domain} / {workflow.microWorkflow.replaceAll("_", " ")}</span>
                  </button>
                ))}
              </div>
              <DemoAssemblyPreview activeWorkflow={activeWorkflow} />
            </div>
          ) : (
            <>
              <div className="agentic-result-head">
                <div>
                  <span>{hasIntentBoundary ? "Intent boundary" : "Generated business workspace"}</span>
                  <h1>{hasIntentBoundary ? "Request recognised" : renderedWorkflow.title}</h1>
                </div>
                <div className="surface-meta">
                  <span>{hasIntentBoundary ? response?.resolution.intent ?? "outside catalog" : renderedWorkflow.audience}</span>
                  <span>{response?.resolution.status ?? (loading ? "composing" : "ready")}</span>
                  {!hasIntentBoundary ? <span>{renderedWorkflow.microWorkflow.replaceAll("_", " ")}</span> : null}
                  {workflowRun ? <span>plan v{workflowRun.agent.planVersion}</span> : null}
                </div>
              </div>

              {error ? (
                <section className="agentic-error">
                  <ShieldAlert size={24} />
                  <p>{error}</p>
                </section>
              ) : null}

              {hasIntentBoundary && response ? (
                <IntentBoundarySurface response={response} />
              ) : (
                <>
                  <MicroWorkflowProgress workflow={renderedWorkflow} run={workflowRun} />
                  <AgentWorkBrief run={workflowRun} loading={loading} />
                  <GeneratedBusinessWorkspace
                    workflow={renderedWorkflow}
                    response={response}
                    audit={audit}
                    loading={loading}
                    subscriptionAmount={subscriptionAmount}
                    setSubscriptionAmount={setSubscriptionAmount}
                    contributionRate={contributionRate}
                    setContributionRate={setContributionRate}
                    retirementAge={retirementAge}
                    setRetirementAge={setRetirementAge}
                    workflowRun={workflowRun}
                    workflowActionLoading={workflowActionLoading}
                    performWorkflowAction={performWorkflowAction}
                  />
                </>
              )}
            </>
          )}
        </section>
      </section>
    </main>
  );
}

function IntentBoundarySurface({ response }: { response: AgentResponse }) {
  const status = response.resolution.status ?? "unsupported";
  const title = status === "needs_clarification"
    ? "One detail is needed before I can act"
    : status === "denied"
      ? "This request was safely stopped"
      : "I understood the request, but it is outside this workspace";
  const capabilityNames: Record<string, string> = {
    personal_investing_isa_allowance_review: "ISA allowance review",
    sipp_drawdown_pathway_review: "SIPP drawdown review",
    workplace_pension_contribution_guidance: "Workplace pension guidance",
    adviser_platform_model_portfolio_review: "Adviser portfolio review"
  };
  const available = response.resolution.availableCapabilities ?? [];

  return (
    <section className={`intent-boundary-surface ${status}`}>
      <div className="intent-boundary-primary">
        <div className="boundary-signal">
          {status === "denied" ? <ShieldAlert size={22} /> : <ShieldCheck size={22} />}
          <span>{status.replaceAll("_", " ")}</span>
        </div>
        <h2>{title}</h2>
        <p>{response.resolution.reasoning}</p>
        <blockquote>{response.prompt}</blockquote>
      </div>
      <aside className="intent-boundary-next">
        <span>Recognised intent</span>
        <strong>{response.resolution.intent ?? "Unclassified request"}</strong>
        {response.resolution.questions?.map((question) => <p key={question}>{question}</p>)}
        {available.length ? (
          <div className="boundary-capabilities">
            <small>This workspace can act on</small>
            {available.map((capability) => (
              <span key={capability}>{capabilityNames[capability] ?? capability.replaceAll("_", " ")}</span>
            ))}
          </div>
        ) : null}
      </aside>
      <footer>
        <CheckCircle2 size={15} />
        <span>No financial workflow was started and no customer data API was called.</span>
      </footer>
    </section>
  );
}

function ScenarioModeStrip({ activeWorkflow }: { activeWorkflow: AgenticWorkflow }) {
  const modes = [
    { label: "Interactive", value: "interactive-report", icon: <BarChart3 size={15} /> },
    { label: "Advisor", value: "advisor-pack", icon: <ClipboardList size={15} /> },
    { label: "Simulation", value: "guided-simulation", icon: <Gauge size={15} /> }
  ];

  return (
    <div className="scenario-mode-strip" aria-label="Scenario interaction pattern">
      {modes.map((mode) => (
        <span className={activeWorkflow.pattern === mode.value ? "active" : ""} key={mode.value}>
          {mode.icon}
          {mode.label}
        </span>
      ))}
    </div>
  );
}

function DemoAssemblyPreview({ activeWorkflow }: { activeWorkflow: AgenticWorkflow }) {
  return (
    <div className="demo-assembly-preview" aria-label="Demo component assembly">
      <div>
        <Network size={16} />
        <span>Generated components</span>
      </div>
      <div className="assembly-grid">
        {activeWorkflow.components.map((component, index) => (
          <span key={component} style={{ animationDelay: `${index * 80}ms` }}>
            {component}
          </span>
        ))}
      </div>
    </div>
  );
}

function MicroWorkflowProgress({
  workflow,
  run
}: {
  workflow: AgenticWorkflow;
  run: WorkflowRun | null;
}) {
  const steps = run?.steps ?? workflow.steps.map((step) => ({ ...step, status: "waiting" as const }));
  const currentStep = run?.currentStepIndex ?? 0;

  return (
    <nav className="micro-workflow-progress" aria-label="Current business workflow">
      {steps.map((step, index) => (
        <button
          type="button"
          className={step.status === "completed" ? "completed" : index === currentStep ? "current" : ""}
          key={step.label}
          disabled
          aria-current={index === currentStep ? "step" : undefined}
        >
          <span>{step.status === "completed" ? <CheckCircle2 size={15} /> : index + 1}</span>
          <div>
            <strong>{step.label}</strong>
            <p>{step.detail}</p>
          </div>
        </button>
      ))}
    </nav>
  );
}

type PerformWorkflowAction = (
  action: WorkflowActionType,
  payload?: Record<string, unknown>
) => Promise<void>;

function AgentWorkBrief({ run, loading }: { run: WorkflowRun | null; loading: boolean }) {
  const latestObservation = run?.observations[run.observations.length - 1];
  const latestRevision = run?.planRevisions[run.planRevisions.length - 1];
  const revised = Boolean(run && run.agent.planVersion > 1);

  return (
    <section className={`agent-work-brief ${revised ? "revised" : ""}`} aria-label="Agent work brief">
      <article>
        <span>Agent objective</span>
        <strong>{loading ? "Understanding the request" : run?.agent.currentActivity ?? "Preparing a business plan"}</strong>
        <p>{run?.agent.objective ?? "Resolving intent, policy boundaries, and the right workflow."}</p>
      </article>
      <article>
        <span>Plan decision</span>
        <strong>{latestRevision ? `Plan v${latestRevision.version}` : "Planning"}</strong>
        <p>{latestRevision?.reason ?? "Waiting for capability evidence before selecting the next steps."}</p>
      </article>
      <article>
        <span>{run?.agent.needsUser ? "Needs your decision" : "Next action"}</span>
        <strong>{run?.agent.needsUser ? "Human in the loop" : "Agent can continue"}</strong>
        <p>{run?.agent.nextAction ?? "The next action will appear when the plan is ready."}</p>
      </article>
      {latestObservation ? (
        <div className="agent-observation">
          <BrainCircuit size={16} />
          <span>Latest observation</span>
          <p>{latestObservation.summary}</p>
        </div>
      ) : null}
    </section>
  );
}

function GeneratedBusinessWorkspace({
  workflow,
  response,
  audit,
  loading,
  subscriptionAmount,
  setSubscriptionAmount,
  contributionRate,
  setContributionRate,
  retirementAge,
  setRetirementAge,
  workflowRun,
  workflowActionLoading,
  performWorkflowAction
}: {
  workflow: AgenticWorkflow;
  response: AgentResponse | null;
  audit: AuditRecord | null;
  loading: boolean;
  subscriptionAmount: number;
  setSubscriptionAmount: (value: number) => void;
  contributionRate: number;
  setContributionRate: (value: number) => void;
  retirementAge: number;
  setRetirementAge: (value: number) => void;
  workflowRun: WorkflowRun | null;
  workflowActionLoading: boolean;
  performWorkflowAction: PerformWorkflowAction;
}) {
  const result = response?.result ?? {};
  const sourceApis = response?.result?.source_apis ?? workflow.apiPlan.map((api) => `${api} API`);
  const confidence = response ? Math.round(response.resolution.confidence * 100) : 0;
  const currentStep = workflowRun?.currentStepIndex ?? 0;
  const currentRunStep = workflowRun?.steps[currentStep];
  const isLastStep = currentStep === (workflowRun?.steps.length ?? workflow.steps.length) - 1;
  const retryRequired = Boolean(currentRunStep?.allowedActions.includes("retry") && currentRunStep.attempts === 0);
  const panelOwnsAction = Boolean(
    currentRunStep?.allowedActions.includes("approve") ||
    retryRequired ||
    currentRunStep?.uiHint === "durable_queue" ||
    currentRunStep?.uiHint === "gap_options"
  );
  const advancePayload = currentRunStep?.uiHint === "amount_slider"
    ? { plannedIsaSubscription: subscriptionAmount }
    : currentRunStep?.uiHint === "goal_controls"
      ? { desiredContributionRate: contributionRate, targetRetirementAge: retirementAge }
      : undefined;

  return (
    <div className="generated-workspace">
      {loading ? (
        <section className="a2ui-loading business-loading">
          <Loader2 className="spin" size={24} />
          <p>Generating a durable business page from intent, policy, APIs, and workflow state.</p>
        </section>
      ) : null}

      <section className="workflow-focus-header">
        <div>
          <span>Now working on</span>
          <h2>{currentRunStep?.label ?? workflow.steps[currentStep]?.label}</h2>
          <p>{currentRunStep?.detail ?? workflow.steps[currentStep]?.detail}</p>
        </div>
        <div className="workflow-focus-status">
          <span>{currentStep + 1} of {workflowRun?.steps.length ?? workflow.steps.length}</span>
          <strong>{response ? `${confidence}% confidence` : loading ? "Working" : "Ready"}</strong>
        </div>
      </section>

      {!loading && workflow.id === "isa-top-up-readiness" ? (
        <IsaTopUpWorkspace
          result={result}
          amount={subscriptionAmount}
          setAmount={setSubscriptionAmount}
          workflowRun={workflowRun}
          actionLoading={workflowActionLoading}
          performWorkflowAction={performWorkflowAction}
          uiHint={currentRunStep?.uiHint}
        />
      ) : null}

      {!loading && workflow.id === "advisor-review-pack" ? (
        <AdvisorPackWorkspace
          result={result}
          workflowRun={workflowRun}
          actionLoading={workflowActionLoading}
          performWorkflowAction={performWorkflowAction}
          uiHint={currentRunStep?.uiHint}
        />
      ) : null}

      {!loading && workflow.id === "retirement-gap" ? (
        <WorkplaceSimulationWorkspace
          result={result}
          contributionRate={contributionRate}
          setContributionRate={setContributionRate}
          retirementAge={retirementAge}
          setRetirementAge={setRetirementAge}
          workflowRun={workflowRun}
          actionLoading={workflowActionLoading}
          performWorkflowAction={performWorkflowAction}
          uiHint={currentRunStep?.uiHint}
        />
      ) : null}

      {!loading && workflowRun && !panelOwnsAction ? <div className="workflow-action-bar backend-action-bar">
        <span className="run-identity">Run {workflowRun.id}</span>
        <span>{isLastStep ? "Final review" : `Next: ${workflowRun.steps[currentStep + 1]?.label}`}</span>
        <button
          type="button"
          className="primary"
          onClick={() => void performWorkflowAction("advance", advancePayload)}
          disabled={workflowActionLoading || workflowRun.status === "completed"}
        >
          {workflowActionLoading ? <Loader2 className="spin" size={16} /> : null}
          <span>{isLastStep ? "Complete workflow" : "Continue"}</span>
          <ChevronRight size={17} />
        </button>
      </div> : null}

      {!loading ? <details className="workflow-evidence">
        <summary>
          <ShieldCheck size={17} />
          <span>How this was completed</span>
          <small>{sourceApis.length} APIs · {workflowRun?.id ?? "run pending"}</small>
        </summary>
        <div className="api-flow">
          {workflow.apiPlan.map((api, index) => (
            <span key={api}><i>{index + 1}</i>{api}</span>
          ))}
        </div>
        <div className="trace-chip-list">
          <span>{response?.result?.audit_trace_id ?? audit?.traceId ?? "audit pending"}</span>
          <span>{response?.resolution.capabilityId?.replaceAll("_", " ") ?? workflow.microWorkflow.replaceAll("_", " ")}</span>
          <span>{workflow.runtime.join(" / ")}</span>
        </div>
      </details> : null}
    </div>
  );
}

function IsaTopUpWorkspace({
  result,
  amount,
  setAmount,
  workflowRun,
  actionLoading,
  performWorkflowAction,
  uiHint
}: {
  result: Record<string, unknown>;
  amount: number;
  setAmount: (value: number) => void;
  workflowRun: WorkflowRun | null;
  actionLoading: boolean;
  performWorkflowAction: PerformWorkflowAction;
  uiHint?: WorkflowUiHint;
}) {
  const remaining = readCurrencyValue(result, ["remaining_allowance"]) ?? 0;
  const used = readCurrencyValue(result, ["subscribed_so_far"]) ?? 0;
  const planned = amount;
  const over = planned > remaining;
  const allowanceTotal = Math.max(20000, used + remaining);
  const availableAfterTopUp = Math.max(allowanceTotal - used - planned, 0);

  if (uiHint === "allowance_donut") {
    return (
      <section className="business-card chart-card">
        <div className="a2ui-card-title">
          <BarChart3 size={20} />
          <h2>ISA allowance allocation</h2>
        </div>
        <DonutChart
          centerLabel="Tax-year allowance"
          centerValue={formatMetricValue(allowanceTotal, "GBP")}
          segments={[
            { label: "Already used", value: used, tone: "blue", formatted: formatMetricValue(used, "GBP") },
            { label: "Planned top-up", value: planned, tone: over ? "red" : "green", formatted: formatMetricValue(planned, "GBP") },
            { label: "Available after", value: availableAfterTopUp, tone: "gold", formatted: formatMetricValue(availableAfterTopUp, "GBP") }
          ]}
        />
      </section>
    );
  }

  if (uiHint === "amount_slider") {
    return (
      <section className="business-card interaction-card">
        <div className="a2ui-card-title">
          <SlidersHorizontal size={20} />
          <h2>Adjust subscription</h2>
        </div>
        <label className="range-control">
          <span>Top-up amount</span>
          <input
            type="range"
            min="1000"
            max="16000"
            step="500"
            value={amount}
            onChange={(event) => setAmount(Number(event.target.value))}
          />
          <strong>{formatMetricValue(amount, "GBP")}</strong>
        </label>
        <div className={over ? "decision-banner warning" : "decision-banner"}>
          {over ? "This amount exceeds the available allowance and needs adjustment." : "This amount is inside the synthetic allowance check."}
        </div>
      </section>
    );
  }

  return (
    <HumanApprovalPanel
      title="Customer confirmation"
      body={`Confirm a ${formatMetricValue(amount, "GBP")} ISA top-up. Submission remains gated until the customer explicitly approves this amount.`}
      workflowRun={workflowRun}
      actionLoading={actionLoading}
      performWorkflowAction={performWorkflowAction}
    />
  );
}

function AdvisorPackWorkspace({
  result,
  workflowRun,
  actionLoading,
  performWorkflowAction,
  uiHint
}: {
  result: Record<string, unknown>;
  workflowRun: WorkflowRun | null;
  actionLoading: boolean;
  performWorkflowAction: PerformWorkflowAction;
  uiHint?: WorkflowUiHint;
}) {
  const drift = Number((result.portfolio_review as Record<string, unknown> | undefined)?.drift_score ?? 5.6);

  if (uiHint === "durable_queue") {
    return <QueuePanel run={workflowRun} actionLoading={actionLoading} performWorkflowAction={performWorkflowAction} />;
  }

  if (uiHint === "portfolio_drift") {
    return (
      <section className="business-card chart-card">
        <div className="a2ui-card-title">
          <BarChart3 size={20} />
          <h2>Portfolio drift</h2>
        </div>
        <div className="chart-composition">
          <DonutChart
            centerLabel="Portfolio"
            centerValue="6 assets"
            segments={[
              { label: "Global equity", value: 55, tone: "green", formatted: "55%" },
              { label: "Fixed income", value: 25, tone: "blue", formatted: "25%" },
              { label: "Alternatives", value: 12, tone: "gold", formatted: "12%" },
              { label: "Cash", value: 8, tone: "muted", formatted: "8%" }
            ]}
          />
          <div className="drift-analysis">
            <MiniBar label="Model drift" value={drift} max={10} tone={drift > 5 ? "gold" : "green"} unit="score" />
            <MiniBar label="Evidence completeness" value={82} max={100} tone="green" unit="%" />
            <MiniBar label="Compliance review" value={64} max={100} tone="blue" unit="%" />
            <div className="decision-banner">Equity is 4.2% above the balanced model target.</div>
          </div>
        </div>
      </section>
    );
  }

  if (uiHint === "retry_checkpoint") {
    return <RetryPanel run={workflowRun} actionLoading={actionLoading} performWorkflowAction={performWorkflowAction} />;
  }

  return (
      <HumanApprovalPanel
        title="Compliance sign-off"
        body="The generated evidence pack waits for adviser sign-off before it can be sent to the client record."
        workflowRun={workflowRun}
        actionLoading={actionLoading}
        performWorkflowAction={performWorkflowAction}
      />
  );
}

function WorkplaceSimulationWorkspace({
  result,
  contributionRate,
  setContributionRate,
  retirementAge,
  setRetirementAge,
  workflowRun,
  actionLoading,
  performWorkflowAction,
  uiHint
}: {
  result: Record<string, unknown>;
  contributionRate: number;
  setContributionRate: (value: number) => void;
  retirementAge: number;
  setRetirementAge: (value: number) => void;
  workflowRun: WorkflowRun | null;
  actionLoading: boolean;
  performWorkflowAction: PerformWorkflowAction;
  uiHint?: WorkflowUiHint;
}) {
  const probabilityRaw = String((result.projected_outcome as Record<string, unknown> | undefined)?.goal_probability ?? "72%");
  const probability = Number(probabilityRaw.replace(/[^\d.]/g, "")) || 72;
  const adjustedProbability = Math.min(96, Math.round(probability + (contributionRate - 10) * 3 + (retirementAge - 65) * 2));

  const controls = (
    <section className="business-card interaction-card">
      <div className="a2ui-card-title">
        <SlidersHorizontal size={20} />
        <h2>Change assumptions</h2>
      </div>
      <label className="range-control">
        <span>Contribution rate</span>
        <input type="range" min="4" max="15" step="1" value={contributionRate} onChange={(event) => setContributionRate(Number(event.target.value))} />
        <strong>{contributionRate}%</strong>
      </label>
      <label className="range-control">
        <span>Retirement age</span>
        <input type="range" min="60" max="70" step="1" value={retirementAge} onChange={(event) => setRetirementAge(Number(event.target.value))} />
        <strong>{retirementAge}</strong>
      </label>
    </section>
  );

  const comparison = (
      <section className="business-card chart-card">
        <div className="a2ui-card-title">
          <BarChart3 size={20} />
          <h2>Goal gap simulator</h2>
        </div>
        <MiniBar label="Current confidence" value={probability} max={100} tone="blue" unit="%" />
        <MiniBar label="Adjusted scenario" value={adjustedProbability} max={100} tone="green" unit="%" />
        <MiniBar label="Employer match captured" value={contributionRate >= 8 ? 100 : 64} max={100} tone="gold" unit="%" />
      </section>
  );

  if (uiHint === "goal_controls") return controls;
  if (uiHint === "gap_options") {
    return (
      <GapOptionsPanel
        contributionRate={contributionRate}
        setContributionRate={setContributionRate}
        retirementAge={retirementAge}
        setRetirementAge={setRetirementAge}
        actionLoading={actionLoading}
        performWorkflowAction={performWorkflowAction}
      />
    );
  }
  if (uiHint === "long_task") {
    return <LongTaskPanel run={workflowRun} actionLoading={actionLoading} performWorkflowAction={performWorkflowAction} />;
  }
  return comparison;
}

function GapOptionsPanel({
  contributionRate,
  setContributionRate,
  retirementAge,
  setRetirementAge,
  actionLoading,
  performWorkflowAction
}: {
  contributionRate: number;
  setContributionRate: (value: number) => void;
  retirementAge: number;
  setRetirementAge: (value: number) => void;
  actionLoading: boolean;
  performWorkflowAction: PerformWorkflowAction;
}) {
  const options = [
    { contribution: 14, age: 65, title: "Save more now", detail: "Increase contributions while keeping retirement at 65." },
    { contribution: 12, age: 67, title: "Work two years longer", detail: "Keep contributions stable and extend the investment horizon." },
    { contribution: 14, age: 67, title: "Close the gap", detail: "Combine both changes for the strongest projected outcome." }
  ];

  const selectOption = (contribution: number, age: number) => {
    setContributionRate(contribution);
    setRetirementAge(age);
    void performWorkflowAction("advance", {
      desiredContributionRate: contribution,
      targetRetirementAge: age
    });
  };

  return (
    <section className="business-card gap-options-card">
      <div className="a2ui-card-title">
        <GitBranch size={20} />
        <h2>Agent-generated ways to close the gap</h2>
      </div>
      <p>The first projection is below the planning threshold, so the Agent added a decision step and prepared three viable alternatives.</p>
      <div className="gap-option-list">
        {options.map((option) => {
          const selected = contributionRate === option.contribution && retirementAge === option.age;
          return (
            <button
              key={`${option.contribution}-${option.age}`}
              type="button"
              className={selected ? "selected" : ""}
              onClick={() => selectOption(option.contribution, option.age)}
              disabled={actionLoading}
            >
              <span>{option.title}</span>
              <strong>{option.contribution}% · age {option.age}</strong>
              <small>{option.detail}</small>
              <ChevronRight size={17} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function MiniBar({
  label,
  value,
  max,
  tone,
  unit
}: {
  label: string;
  value: number;
  max: number;
  tone: "green" | "blue" | "gold" | "red";
  unit: string;
}) {
  return (
    <div className="a2ui-chart-row">
      <span>{label}</span>
      <div>
        <i className={`tone-${tone}`} style={{ width: `${Math.min(100, Math.max(4, (value / max) * 100))}%` }} />
      </div>
      <strong>{formatMetricValue(value, unit)}</strong>
    </div>
  );
}

function DonutChart({
  centerLabel,
  centerValue,
  segments
}: {
  centerLabel: string;
  centerValue: string;
  segments: Array<{
    label: string;
    value: number;
    tone: "green" | "blue" | "gold" | "red" | "muted";
    formatted: string;
  }>;
}) {
  const total = Math.max(segments.reduce((sum, segment) => sum + Math.max(segment.value, 0), 0), 1);
  let cursor = 0;
  const stops = segments.map((segment) => {
    const start = cursor;
    cursor += (Math.max(segment.value, 0) / total) * 100;
    return `var(--donut-${segment.tone}) ${start}% ${cursor}%`;
  });

  return (
    <div className="donut-chart">
      <div className="donut-visual" style={{ background: `conic-gradient(${stops.join(", ")})` }} role="img" aria-label={segments.map((segment) => `${segment.label} ${segment.formatted}`).join(", ")}>
        <div>
          <strong>{centerValue}</strong>
          <span>{centerLabel}</span>
        </div>
      </div>
      <div className="donut-legend">
        {segments.map((segment) => (
          <div key={segment.label}>
            <i className={`donut-swatch ${segment.tone}`} />
            <span>{segment.label}</span>
            <strong>{segment.formatted}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function LongTaskPanel({
  run,
  actionLoading,
  performWorkflowAction
}: {
  run: WorkflowRun | null;
  actionLoading: boolean;
  performWorkflowAction: PerformWorkflowAction;
}) {
  const currentStep = run?.steps[run.currentStepIndex];
  const complete = Boolean(currentStep && currentStep.attempts > 0);

  return (
    <section className={`business-card long-task-card ${complete ? "complete" : ""}`}>
      <div className="a2ui-card-title">
        <Route size={20} />
        <h2>Durable retirement projection</h2>
      </div>
      <p>The forecast can continue in the background. Completed checkpoints are retained if the user leaves this page.</p>
      <div className="long-task-timeline">
        <span className="complete"><CheckCircle2 size={15} /> Account data saved</span>
        <span className="complete"><CheckCircle2 size={15} /> Contribution history saved</span>
        <span className={complete ? "complete" : "running"}>
          {actionLoading ? <Loader2 className="spin" size={15} /> : complete ? <CheckCircle2 size={15} /> : <Route size={15} />}
          {complete ? "Projection recovered from checkpoint" : actionLoading ? "Projection running" : "Projection paused at checkpoint"}
        </span>
      </div>
      <button type="button" onClick={() => void performWorkflowAction("retry")} disabled={actionLoading || complete || !run}>
        {actionLoading ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
        <span>{complete ? "Checkpoint recovered" : actionLoading ? "Continuing" : "Resume projection"}</span>
      </button>
    </section>
  );
}

function RetryPanel({
  run,
  actionLoading,
  performWorkflowAction
}: {
  run: WorkflowRun | null;
  actionLoading: boolean;
  performWorkflowAction: PerformWorkflowAction;
}) {
  const currentStep = run?.steps[run.currentStepIndex];
  const recovered = Boolean(currentStep && currentStep.attempts > 0);
  const state = actionLoading ? "retrying" : recovered ? "recovered" : "degraded";
  const copy = actionLoading
      ? "Retrying projection service with preserved successful API results."
      : recovered
        ? "Projection recovered. The generated page updated without restarting the workflow."
        : "Projection service is degraded. Holdings and policy results are durable and can be reused.";

  return (
    <section className={`business-card retry-card ${state}`}>
      <div className="a2ui-card-title">
        <Route size={20} />
        <h2>Retryable service</h2>
      </div>
      <p>{copy}</p>
      <button type="button" onClick={() => void performWorkflowAction("retry")} disabled={actionLoading || recovered || !run}>
        {actionLoading ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
        <span>{recovered ? "Retry complete" : "Retry projection"}</span>
      </button>
    </section>
  );
}

function QueuePanel({
  run,
  actionLoading,
  performWorkflowAction
}: {
  run: WorkflowRun | null;
  actionLoading: boolean;
  performWorkflowAction: PerformWorkflowAction;
}) {
  return (
    <section className="business-card queue-card">
      <div className="a2ui-card-title">
        <GitBranch size={20} />
        <h2>Long-running queue</h2>
      </div>
      <div className="queue-list">
        <article className="queue-item ready">
          <span>{run?.status ?? "pending"}</span>
          <strong>{run?.id ?? "Creating workflow run"}</strong>
        </article>
        <article className="queue-item">
          <span>capability</span>
          <strong>{run?.capabilityId.replaceAll("_", " ") ?? "Resolving capability"}</strong>
        </article>
      </div>
      <button type="button" onClick={() => void performWorkflowAction("advance")} disabled={actionLoading || !run}>
        {actionLoading ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
        <span>{actionLoading ? "Starting task" : "Start queued task"}</span>
      </button>
    </section>
  );
}

function HumanApprovalPanel({
  title,
  body,
  workflowRun,
  actionLoading,
  performWorkflowAction
}: {
  title: string;
  body: string;
  workflowRun: WorkflowRun | null;
  actionLoading: boolean;
  performWorkflowAction: PerformWorkflowAction;
}) {
  const approved = workflowRun?.status === "completed";
  return (
    <section className={`business-card approval-card ${approved ? "approved" : "requested"}`}>
      <div className="a2ui-card-title">
        <LockKeyhole size={20} />
        <h2>{title}</h2>
      </div>
      <p>{body}</p>
      <div className="decision-banner">Run status: {workflowRun?.status.replaceAll("_", " ") ?? "pending"}</div>
      <div className="approval-actions">
        <button type="button" onClick={() => void performWorkflowAction("approve")} disabled={actionLoading || approved || !workflowRun}>
          {actionLoading ? <Loader2 className="spin" size={16} /> : <CheckCircle2 size={16} />}
          <span>{approved ? "Approved in backend" : "Approve and complete"}</span>
        </button>
      </div>
    </section>
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
