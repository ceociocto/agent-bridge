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
  RotateCcw,
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
  id:
    | "isa-top-up-readiness"
    | "advisor-review-pack"
    | "retirement-gap"
    | "pension-cash-access"
    | "pension-retirement-choice";
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

type AgenticChatTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  intent: string;
  workflowId: string;
  timestamp: string;
  status?: AgentResponse["resolution"]["status"];
};

type PensionFlowState = {
  stage: "decision" | "purpose" | "compare" | "application" | "identity" | "authorization" | "submitted";
  selectedAction: string;
  selectedRouteLabel?: string;
  routeMaxAmount?: number;
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
  },
  {
    id: "pension-cash-access",
    domain: "Workplace Investing",
    audience: "Member",
    label: "公积金提取",
    title: "公积金提取方案",
    prompt: "我最近手头紧，要提取一些公积金",
    capabilityId: "retirement_pension_task_orchestration",
    input: {
      customerId: "CN001",
      pensionTaskIntent: "cash_access_exploration",
      requestedWithdrawalAmount: 100000,
      microWorkflowId: "retirement_pension_task_orchestration"
    },
    pattern: "guided-simulation",
    microWorkflow: "retirement_pension_task_orchestration",
    apiPlan: ["会员画像", "公积金账户", "提取资格", "提取路径", "到账测算", "策略审计"],
    runtime: ["durable", "human-loop"],
    components: ["目标摘要", "已补全资料", "到账测算", "关键决定"],
    narrative: "中文场景：围绕用户提取公积金的目标准备方案，不直接进入资金申请。",
    steps: [
      { label: "解析意图", detail: "识别用户是在探索资金可得性，而不是直接提交申请。" },
      { label: "加载上下文", detail: "自动读取账户余额、身份状态、已验证银行卡等已知信息。" },
      { label: "检查资格", detail: "组装提取资格和可选路径，不让模型自由裁决合规结果。" },
      { label: "估算影响", detail: "展示税费、到账金额和长期退休收入影响。" }
    ]
  },
  {
    id: "pension-retirement-choice",
    domain: "Workplace Investing",
    audience: "Member",
    label: "退休规划",
    title: "退休时间与领取策略",
    prompt: "我准备退休，想知道什么时候退休最合适，以及应该怎样领取养老金。",
    capabilityId: "retirement_pension_task_orchestration",
    input: {
      customerId: "CN001",
      pensionTaskIntent: "retirement_claim_planning",
      targetRetirementAge: 63,
      microWorkflowId: "retirement_pension_task_orchestration"
    },
    pattern: "guided-simulation",
    microWorkflow: "retirement_pension_task_orchestration",
    apiPlan: ["会员画像", "养老金账户", "退休时间线", "领取测算", "策略比较", "策略审计"],
    runtime: ["long-task", "durable", "human-loop"],
    components: ["意图摘要", "退休时间线", "领取策略", "方案比较"],
    narrative: "中文场景：同一养老金能力被组装成规划界面，而不是提取流程。",
    steps: [
      { label: "解析意图", detail: "识别用户目标是退休规划和领取策略，而不是养老金提取。" },
      { label: "加载上下文", detail: "读取养老金账户、年龄、缴费历史和预计退休窗口。" },
      { label: "生成时间线", detail: "比较不同退休年龄下的收入和现金流。" },
      { label: "比较领取", detail: "动态展示按月领取、部分一次性领取等策略。" }
    ]
  }
];

const workflowById = new Map(agenticWorkflows.map((workflow) => [workflow.id, workflow]));
const defaultAgenticWorkflow = workflowById.get("pension-cash-access") ?? agenticWorkflows[0];

function inferWorkflowFromConversation(prompt: string, fallback: AgenticWorkflow) {
  const normalized = prompt.toLowerCase();
  const signals = [
    {
      workflow: workflowById.get("pension-cash-access") ?? fallback,
      score: ["缺钱", "手头紧", "公积金", "住房公积金", "取一部分", "提取", "能不能取", "拿出来", "access pension", "withdraw pension"].filter((term) => normalized.includes(term)).length
    },
    {
      workflow: workflowById.get("pension-retirement-choice") ?? fallback,
      score: ["准备退休", "什么时候退休", "怎样领取", "领取养老金", "退休最合适", "claim strategy"].filter((term) => normalized.includes(term)).length
    },
    {
      workflow: workflowById.get("advisor-review-pack") ?? fallback,
      score: ["adviser", "advisor", "model portfolio", "portfolio drift", "review pack", "client pack"].filter((term) => normalized.includes(term)).length
    },
    {
      workflow: workflowById.get("retirement-gap") ?? fallback,
      score: ["retire", "retirement", "pension", "contribution", "goal", "gap", "65", "workplace"].filter((term) => normalized.includes(term)).length
    },
    {
      workflow: workflowById.get("isa-top-up-readiness") ?? fallback,
      score: ["isa", "stocks and shares", "subscription", "allowance", "top up", "top-up", "tax year"].filter((term) => normalized.includes(term)).length
    }
  ].sort((a, b) => b.score - a.score);

  return signals[0]?.score ? { workflow: signals[0].workflow, score: signals[0].score } : null;
}

function buildCondensedIntent(history: AgenticChatTurn[], question: string, workflow: AgenticWorkflow) {
  const recentUserTurns = history
    .filter((turn) => turn.role === "user")
    .slice(-3)
    .map((turn) => turn.text);
  const threadText = [...recentUserTurns, question].join(" ");
  const contribution = extractContributionRateFromPrompt(threadText);
  const retirement = extractRetirementAgeFromPrompt(threadText);
  const fragments = [`${workflow.audience.toLowerCase()} intent: ${workflow.title}`];

  if (workflow.domain === "Workplace Investing") {
    if (Number.isFinite(retirement)) fragments.push(`retirement age ${retirement}`);
    if (Number.isFinite(contribution)) fragments.push(`contribution ${contribution}%`);
  }

  if (workflow.id === "pension-cash-access") {
    fragments.push("mode 公积金提取准备 · no transaction started");
  }

  if (workflow.id === "pension-retirement-choice") {
    fragments.push("mode 规划 · claim not started");
  }

  if (workflow.id === "isa-top-up-readiness") {
    const amountMatch = threadText.match(/(?:£|gbp\s*)\s?(\d{1,3}(?:,\d{3})*|\d+)/i);
    if (amountMatch) fragments.push(`planned ISA amount £${amountMatch[1]}`);
  }

  return fragments.join(" · ");
}

function isLocalPensionWorkflow(workflow: AgenticWorkflow) {
  return false;
}

function isPensionWorkflow(workflow: AgenticWorkflow) {
  return workflow.id === "pension-cash-access" || workflow.id === "pension-retirement-choice";
}

function selectedPensionRouteHint(routeName: string) {
  if (routeName.includes("住房")) {
    return {
      label: "确认住房用途",
      detail: "系统会继续确认是否用于本人主要住房、是否有未还贷款，以及需要哪些证明。",
      emphasis: "更适合房贷、租房或主要住房相关资金需求。"
    };
  }
  if (routeName.includes("困难")) {
    return {
      label: "补充困难情况",
      detail: "系统会先确认困难类型和证明材料，再判断是否需要人工审核。",
      emphasis: "更适合短期收入变化、医疗或生活困难等情况。"
    };
  }
  return {
    label: "继续确认用途",
    detail: "系统会根据你的选择继续缩小范围，尚不会提交正式申请。",
    emphasis: "先判断能不能取，再决定是否进入申请。"
  };
}

function parseYuanAmount(value: unknown) {
  const raw = String(value ?? "").replace(/[¥,\s]/g, "");
  const amount = Number(raw);
  return Number.isFinite(amount) ? amount : undefined;
}

function formatYuanAmount(value: number) {
  return `¥${Math.round(value).toLocaleString("en-US")}`;
}

function estimateNetRange(amount: number) {
  return `${formatYuanAmount(amount * 0.92)} - ${formatYuanAmount(amount * 0.95)}`;
}

function createLocalPensionAgentResponse(workflow: AgenticWorkflow, prompt: string): AgentResponse {
  const now = new Date().toISOString();
  const isCashAccess = workflow.id === "pension-cash-access";
  const taskPlan = buildPensionTaskPlan(isCashAccess ? pensionIntentScenarios[0] : pensionIntentScenarios[1]);
  const runSteps = workflow.steps.map((step, index) => ({
    id: `${workflow.id}-step-${index + 1}`,
    label: step.label,
    detail: step.detail,
    status: index < workflow.steps.length - 1 ? "completed" as const : "requires_action" as const,
    allowedActions: [] as WorkflowActionType[],
    uiHint: "scenario_comparison" as WorkflowUiHint,
    attempts: 1,
    updatedAt: now
  }));
  const summary = isCashAccess
    ? "已根据“最近缺钱”的模糊需求组装为养老金提取探索工作区：先做资格路径与影响测算，尚未创建任何正式申请。"
    : "已根据“准备退休”的规划需求组装为退休时间与领取策略工作区：比较退休年龄和领取方式，尚未进入领取申请。";
  const result: WorkflowRun["result"] = {
    capability: "workplace_pension_contribution_guidance",
    summary,
    source_apis: workflow.apiPlan,
    audit_trace_id: `local-pension-audit-${workflow.id}`,
    policy_checks: [
      { name: "只读探索模式", status: "passed", detail: "本次演示没有提交交易、没有创建申请。" },
      { name: "受控阶段库", status: "passed", detail: "Task Plan 只从预定义阶段库中补全依赖和组件。" }
    ],
    next_actions: [
      { id: "clarify_next_decision", label: isCashAccess ? "确认提取原因" : "选择偏好的退休年龄" }
    ],
    task_plan: taskPlan.map((stage) => ({
      id: stage.id,
      title: stage.title,
      source: stage.source,
      microWorkflow: stage.microWorkflow,
      component: stage.component
    }))
  };

  return {
    prompt,
    resolution: {
      status: "resolved",
      intent: isCashAccess ? "access_pension_funds" : "plan_retirement_and_claim_strategy",
      capabilityId: "workplace_pension_contribution_guidance",
      confidence: isCashAccess ? 0.93 : 0.91,
      reasoning: summary,
      resolver: "rules",
      policyDecision: { name: "local pension demo", status: "passed", detail: "Synthetic runtime response for dynamic UI assembly." }
    },
    result,
    workflowRun: {
      id: `local-pension-run-${workflow.id}`,
      microWorkflowId: "retirement_goal_gap_projection",
      capabilityId: "workplace_pension_contribution_guidance",
      status: "waiting_for_human",
      currentStepIndex: workflow.steps.length - 1,
      steps: runSteps,
      input: workflow.input as WorkflowRun["input"],
      result,
      auditTraceId: `local-pension-audit-${workflow.id}`,
      createdAt: now,
      updatedAt: now,
      agent: {
        objective: isCashAccess
          ? "把模糊的资金需求收敛为可解释的养老金提取探索任务。"
          : "把退休规划需求收敛为时间线和领取策略比较任务。",
        currentActivity: isCashAccess ? "动态组装提取探索工作区" : "动态组装退休规划工作区",
        decisionRationale: "Planner 先选中意图目标阶段，再由阶段库自动补全数据依赖和受控组件。",
        nextAction: isCashAccess ? "询问提取原因或比较低影响方案。" : "让用户选择要重点比较的退休年龄或领取方式。",
        needsUser: true,
        planVersion: 2
      },
      observations: [
        {
          id: `obs-${workflow.id}`,
          timestamp: now,
          kind: "business_result",
          summary,
          evidence: { taskPlanSize: taskPlan.length, components: workflow.components }
        }
      ],
      planRevisions: [
        {
          id: `rev-${workflow.id}`,
          timestamp: now,
          version: 2,
          reason: "根据中文意图动态选择目标阶段，并自动补全画像与账户加载依赖。",
          addedStepIds: taskPlan.map((stage) => stage.id),
          removedStepIds: []
        }
      ],
      events: [
        {
          id: `event-${workflow.id}`,
          timestamp: now,
          type: "run.created",
          summary: "Local pension task run assembled from intent.",
          stepId: runSteps[0]?.id ?? workflow.id
        }
      ]
    }
  };
}

function buildConversationPrompt(history: AgenticChatTurn[], question: string, condensedIntent: string) {
  const compactHistory = history
    .slice(-6)
    .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.text}`)
    .join("\n");

  return [
    compactHistory ? `Prior conversation:\n${compactHistory}` : "",
    `Current condensed intent: ${condensedIntent}`,
    `Latest user request: ${question}`
  ].filter(Boolean).join("\n\n");
}

type AgenticUiStageId =
  | "LoadMemberProfile"
  | "LoadPensionAccounts"
  | "ReviewPensionComposition"
  | "CheckWithdrawalEligibility"
  | "EstimateWithdrawalImpact"
  | "CompareWithdrawalRoutes"
  | "StartControlledApplication";

type AgenticUiStageDefinition = {
  id: AgenticUiStageId;
  title: string;
  brief: string;
  requires: AgenticUiStageId[];
  capability: string;
  component: string;
};

type AgenticUiScenario = {
  id: "withdraw-access" | "pot-composition";
  label: string;
  prompt: string;
  intent: string;
  goal: string;
  confidence: number;
  targetStages: AgenticUiStageId[];
  primaryMetric: string;
  secondaryMetric: string;
};

const agenticUiStageLibrary: Record<AgenticUiStageId, AgenticUiStageDefinition> = {
  LoadMemberProfile: {
    id: "LoadMemberProfile",
    title: "Load member profile",
    brief: "Member age band, employment status, scheme membership.",
    requires: [],
    capability: "Member profile",
    component: "Profile summary"
  },
  LoadPensionAccounts: {
    id: "LoadPensionAccounts",
    title: "Load pension accounts",
    brief: "Current workplace pension, SIPP and available cash data.",
    requires: ["LoadMemberProfile"],
    capability: "Pension accounts",
    component: "Account summary"
  },
  ReviewPensionComposition: {
    id: "ReviewPensionComposition",
    title: "Review pension composition",
    brief: "Break down pot sources before any withdrawal decision.",
    requires: ["LoadPensionAccounts"],
    capability: "Pot composition",
    component: "Composition chart"
  },
  CheckWithdrawalEligibility: {
    id: "CheckWithdrawalEligibility",
    title: "Check withdrawal eligibility",
    brief: "Determine possible access routes and missing evidence.",
    requires: ["LoadPensionAccounts"],
    capability: "Withdrawal eligibility",
    component: "Eligibility result"
  },
  EstimateWithdrawalImpact: {
    id: "EstimateWithdrawalImpact",
    title: "Estimate withdrawal impact",
    brief: "Show likely tax band, pot reduction and future income effect.",
    requires: ["CheckWithdrawalEligibility", "ReviewPensionComposition"],
    capability: "Impact simulation",
    component: "Impact preview"
  },
  CompareWithdrawalRoutes: {
    id: "CompareWithdrawalRoutes",
    title: "Compare withdrawal routes",
    brief: "Compare lower-impact access options before application.",
    requires: ["EstimateWithdrawalImpact"],
    capability: "Route comparison",
    component: "Route choices"
  },
  StartControlledApplication: {
    id: "StartControlledApplication",
    title: "Start controlled application",
    brief: "Open a governed application with disclosures and identity checks.",
    requires: ["CompareWithdrawalRoutes"],
    capability: "Application workflow",
    component: "Application gate"
  }
};

const agenticUiScenarios: AgenticUiScenario[] = [
  {
    id: "withdraw-access",
    label: "Can I take money out?",
    prompt: "I’m short of money. Can I take some money from my pension?",
    intent: "access_pension_funds",
    goal: "Explore whether pension funds can be accessed without starting an application.",
    confidence: 0.91,
    targetStages: ["CheckWithdrawalEligibility", "EstimateWithdrawalImpact", "CompareWithdrawalRoutes"],
    primaryMetric: "Eligibility exploration",
    secondaryMetric: "No transaction started"
  },
  {
    id: "pot-composition",
    label: "What is my pot made of?",
    prompt: "Before I withdraw, how is my pension pot split across different components?",
    intent: "understand_pension_pot_composition",
    goal: "Explain pension pot composition before deciding whether withdrawal is sensible.",
    confidence: 0.87,
    targetStages: ["ReviewPensionComposition"],
    primaryMetric: "Composition analysis",
    secondaryMetric: "Read-only task"
  }
];

function buildAgenticUiTaskPlan(scenario: AgenticUiScenario) {
  const explicitStages = new Set<AgenticUiStageId>(scenario.targetStages);
  const included = new Set<AgenticUiStageId>();
  const ordered: AgenticUiStageId[] = [];

  function includeStage(stageId: AgenticUiStageId) {
    if (included.has(stageId)) return;
    const stage = agenticUiStageLibrary[stageId];
    stage.requires.forEach(includeStage);
    included.add(stageId);
    ordered.push(stageId);
  }

  scenario.targetStages.forEach(includeStage);

  return ordered.map((stageId) => ({
    ...agenticUiStageLibrary[stageId],
    source: explicitStages.has(stageId) ? "intent" : "dependency"
  }));
}

function AgenticUiPage() {
  const [scenarioId, setScenarioId] = useState<AgenticUiScenario["id"]>("withdraw-access");
  const scenario = agenticUiScenarios.find((item) => item.id === scenarioId) ?? agenticUiScenarios[0];
  const taskPlan = buildAgenticUiTaskPlan(scenario);
  const dependencyStages = taskPlan.filter((stage) => stage.source === "dependency");
  const intentStages = taskPlan.filter((stage) => stage.source === "intent");
  const hasComposition = taskPlan.some((stage) => stage.id === "ReviewPensionComposition");
  const hasEligibility = taskPlan.some((stage) => stage.id === "CheckWithdrawalEligibility");
  const hasImpact = taskPlan.some((stage) => stage.id === "EstimateWithdrawalImpact");
  const hasRouteComparison = taskPlan.some((stage) => stage.id === "CompareWithdrawalRoutes");

  return (
    <main className="agentic-ui-shell">
      <section className="agentic-ui-topbar">
        <a href="/" className="agentic-ui-link">
          <PanelsTopLeft size={17} />
          <span>Agent-Bridge</span>
        </a>
        <a href="/agentic" className="agentic-ui-link secondary">
          <Route size={17} />
          <span>Runtime demo</span>
        </a>
      </section>

      <section className="agentic-ui-hero">
        <div>
          <p>Retirement Capability</p>
          <h1>Agentic UI assembled from business intent.</h1>
        </div>
        <div className="agentic-ui-intent-switcher" aria-label="Choose a pension question">
          {agenticUiScenarios.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === scenario.id ? "active" : ""}
              onClick={() => setScenarioId(item.id)}
            >
              <span>{item.label}</span>
              <small>{item.prompt}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="agentic-ui-layout">
        <aside className="agentic-ui-intent-panel">
          <div className="agentic-ui-panel-title">
            <BrainCircuit size={18} />
            <span>Intent result</span>
          </div>
          <blockquote>{scenario.prompt}</blockquote>
          <dl>
            <div>
              <dt>Goal</dt>
              <dd>{scenario.goal}</dd>
            </div>
            <div>
              <dt>Intent</dt>
              <dd>{scenario.intent}</dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>{Math.round(scenario.confidence * 100)}%</dd>
            </div>
          </dl>
        </aside>

        <section className="agentic-ui-workspace" aria-live="polite">
          <div className="agentic-ui-workspace-head">
            <div>
              <span>{scenario.primaryMetric}</span>
              <h2>{scenario.id === "withdraw-access" ? "Pension access workspace" : "Pension composition workspace"}</h2>
            </div>
            <strong>{scenario.secondaryMetric}</strong>
          </div>

          <div className="agentic-ui-member-strip">
            <article>
              <span>Member</span>
              <strong>Aisha Morgan</strong>
            </article>
            <article>
              <span>Total pension pot</span>
              <strong>£428,600</strong>
            </article>
            <article>
              <span>Scheme status</span>
              <strong>Active member</strong>
            </article>
          </div>

          {hasComposition ? <PensionCompositionCard compact={scenario.id === "withdraw-access"} /> : null}
          {hasEligibility ? <WithdrawalEligibilityCard /> : null}
          {hasImpact ? <WithdrawalImpactCard /> : null}
          {hasRouteComparison ? <WithdrawalRouteCard /> : null}
        </section>

        <aside className="agentic-ui-plan-panel">
          <div className="agentic-ui-panel-title">
            <GitBranch size={18} />
            <span>Task Plan</span>
          </div>
          <div className="agentic-ui-plan-summary">
            <div>
              <span>Intent matched</span>
              <strong>{intentStages.length} steps</strong>
            </div>
            <div>
              <span>Auto-added</span>
              <strong>{dependencyStages.length} dependencies</strong>
            </div>
          </div>
          <ol className="agentic-ui-step-list">
            {taskPlan.map((stage, index) => (
              <li key={stage.id} className={stage.source}>
                <span>{index + 1}</span>
                <div>
                  <strong>{stage.title}</strong>
                  <p>{stage.brief}</p>
                  <small>{stage.source === "intent" ? "Intent target" : "Auto-added dependency"}</small>
                </div>
              </li>
            ))}
          </ol>
          <div className="agentic-ui-stage-contract">
            <span>Planner input</span>
            <p>Intent chooses target stages. The stage registry supplies dependencies and allowed components.</p>
          </div>
        </aside>
      </section>
    </main>
  );
}

function PensionCompositionCard({ compact }: { compact: boolean }) {
  const rows = [
    { label: "Workplace pension", value: 58, amount: "£248,600" },
    { label: "Employer contributions", value: 22, amount: "£94,300" },
    { label: "SIPP holdings", value: 14, amount: "£60,000" },
    { label: "Cash reserve", value: 6, amount: "£25,700" }
  ];

  return (
    <section className={`agentic-ui-business-section ${compact ? "compact" : ""}`}>
      <div className="agentic-ui-section-head">
        <div>
          <span>Pot composition</span>
          <h3>Where the pension value sits</h3>
        </div>
        <BarChart3 size={20} />
      </div>
      <div className="agentic-ui-composition">
        {rows.map((row) => (
          <div className="agentic-ui-composition-row" key={row.label}>
            <div>
              <strong>{row.label}</strong>
              <span>{row.amount}</span>
            </div>
            <div className="agentic-ui-bar" aria-label={`${row.label} ${row.value}%`}>
              <span style={{ width: `${row.value}%` }} />
            </div>
            <em>{row.value}%</em>
          </div>
        ))}
      </div>
    </section>
  );
}

function WithdrawalEligibilityCard() {
  return (
    <section className="agentic-ui-business-section">
      <div className="agentic-ui-section-head">
        <div>
          <span>Eligibility</span>
          <h3>Possible access routes</h3>
        </div>
        <ShieldCheck size={20} />
      </div>
      <div className="agentic-ui-route-grid">
        <article className="ready">
          <span>Available to explore</span>
          <strong>Flexible access</strong>
          <p>Needs income impact review before an application can begin.</p>
        </article>
        <article>
          <span>Evidence needed</span>
          <strong>Hardship route</strong>
          <p>Requires supporting documents and manual review.</p>
        </article>
      </div>
    </section>
  );
}

function WithdrawalImpactCard() {
  return (
    <section className="agentic-ui-business-section">
      <div className="agentic-ui-section-head">
        <div>
          <span>Impact preview</span>
          <h3>Illustrative effect of taking £25,000</h3>
        </div>
        <Gauge size={20} />
      </div>
      <div className="agentic-ui-impact-grid">
        <article>
          <span>Pot after withdrawal</span>
          <strong>£403,600</strong>
        </article>
        <article>
          <span>Future monthly income</span>
          <strong>-£118</strong>
        </article>
        <article>
          <span>Tax position</span>
          <strong>Needs confirmation</strong>
        </article>
      </div>
    </section>
  );
}

function WithdrawalRouteCard() {
  return (
    <section className="agentic-ui-business-section">
      <div className="agentic-ui-section-head">
        <div>
          <span>Next decision</span>
          <h3>Choose how to continue</h3>
        </div>
        <ClipboardList size={20} />
      </div>
      <div className="agentic-ui-action-row">
        <button type="button">
          <Search size={16} />
          <span>Compare lower-impact options</span>
        </button>
        <button type="button">
          <LockKeyhole size={16} />
          <span>Start controlled application</span>
        </button>
      </div>
    </section>
  );
}

type PensionIntentScenarioId = "cash-access" | "retirement-choice";

type PensionIntentStageId =
  | "ResolveMemberIntent"
  | "LoadRetirementProfile"
  | "LoadPensionPortfolio"
  | "CheckAccessEligibility"
  | "CompareAccessRoutes"
  | "EstimateWithdrawalImpact"
  | "BuildRetirementTimeline"
  | "SimulateBenefitOptions"
  | "CompareClaimStrategies"
  | "ControlledExecutionGate";

type PensionIntentStage = {
  id: PensionIntentStageId;
  title: string;
  kind: "intent" | "data" | "workflow" | "decision" | "gate";
  dependsOn: PensionIntentStageId[];
  microWorkflow: string;
  component: string;
};

type PensionIntentScenario = {
  id: PensionIntentScenarioId;
  label: string;
  prompt: string;
  intent: string;
  mode: "探索" | "规划";
  goal: string;
  targetStages: PensionIntentStageId[];
  workspaceTitle: string;
  workspaceHint: string;
};

const pensionStageLibrary: Record<PensionIntentStageId, PensionIntentStage> = {
  ResolveMemberIntent: {
    id: "ResolveMemberIntent",
    title: "解析用户目标",
    kind: "intent",
    dependsOn: [],
    microWorkflow: "intent_resolution",
    component: "IntentSummary"
  },
  LoadRetirementProfile: {
    id: "LoadRetirementProfile",
    title: "读取会员画像",
    kind: "data",
    dependsOn: ["ResolveMemberIntent"],
    microWorkflow: "member_context_loading",
    component: "KnownFacts"
  },
  LoadPensionPortfolio: {
    id: "LoadPensionPortfolio",
    title: "读取养老金账户",
    kind: "data",
    dependsOn: ["LoadRetirementProfile"],
    microWorkflow: "pension_portfolio_loading",
    component: "AccountStrip"
  },
  CheckAccessEligibility: {
    id: "CheckAccessEligibility",
    title: "检查可提取资格",
    kind: "workflow",
    dependsOn: ["LoadPensionPortfolio"],
    microWorkflow: "withdrawal_eligibility_check",
    component: "EligibilityRoutes"
  },
  CompareAccessRoutes: {
    id: "CompareAccessRoutes",
    title: "比较提取路径",
    kind: "decision",
    dependsOn: ["CheckAccessEligibility"],
    microWorkflow: "withdrawal_route_comparison",
    component: "RouteCards"
  },
  EstimateWithdrawalImpact: {
    id: "EstimateWithdrawalImpact",
    title: "估算提取影响",
    kind: "workflow",
    dependsOn: ["CompareAccessRoutes"],
    microWorkflow: "withdrawal_impact_simulation",
    component: "ImpactPreview"
  },
  BuildRetirementTimeline: {
    id: "BuildRetirementTimeline",
    title: "生成退休时间线",
    kind: "workflow",
    dependsOn: ["LoadPensionPortfolio"],
    microWorkflow: "retirement_timeline_projection",
    component: "Timeline"
  },
  SimulateBenefitOptions: {
    id: "SimulateBenefitOptions",
    title: "测算领取方案",
    kind: "workflow",
    dependsOn: ["BuildRetirementTimeline"],
    microWorkflow: "benefit_option_simulation",
    component: "BenefitComparison"
  },
  CompareClaimStrategies: {
    id: "CompareClaimStrategies",
    title: "比较领取策略",
    kind: "decision",
    dependsOn: ["SimulateBenefitOptions"],
    microWorkflow: "claim_strategy_comparison",
    component: "StrategyMatrix"
  },
  ControlledExecutionGate: {
    id: "ControlledExecutionGate",
    title: "受控办理入口",
    kind: "gate",
    dependsOn: ["EstimateWithdrawalImpact", "CompareClaimStrategies"],
    microWorkflow: "controlled_application_gate",
    component: "AuthorizationGate"
  }
};

const pensionIntentScenarios: PensionIntentScenario[] = [
  {
    id: "cash-access",
    label: "最近缺钱",
    prompt: "我最近手头紧，要提取一些公积金",
    intent: "access_pension_funds",
    mode: "探索",
    goal: "先判断能否取、预计到账多少、还需要哪些关键决定，不立即创建申请。",
    targetStages: ["CheckAccessEligibility", "CompareAccessRoutes", "EstimateWithdrawalImpact"],
    workspaceTitle: "公积金提取方案工作区",
    workspaceHint: "系统已围绕提取目标准备方案，未进入正式资金申请"
  },
  {
    id: "retirement-choice",
    label: "准备退休",
    prompt: "我准备退休，想知道什么时候退休最合适，以及应该怎样领取养老金。",
    intent: "plan_retirement_and_claim_strategy",
    mode: "规划",
    goal: "比较退休时间、月度领取和一次性领取等方案，只有用户明确办理时才进入申请。",
    targetStages: ["BuildRetirementTimeline", "SimulateBenefitOptions", "CompareClaimStrategies"],
    workspaceTitle: "退休规划与领取策略工作区",
    workspaceHint: "当前是规划模式，输出方案比较而不是固定申请表"
  }
];

function buildPensionTaskPlan(scenario: PensionIntentScenario) {
  const targetStageSet = new Set<PensionIntentStageId>(scenario.targetStages);
  const included = new Set<PensionIntentStageId>();
  const ordered: PensionIntentStageId[] = [];

  function include(stageId: PensionIntentStageId) {
    if (included.has(stageId)) return;
    const stage = pensionStageLibrary[stageId];
    stage.dependsOn.forEach(include);
    included.add(stageId);
    ordered.push(stageId);
  }

  scenario.targetStages.forEach(include);

  return ordered.map((stage) => ({
    ...pensionStageLibrary[stage],
    source: targetStageSet.has(stage) ? "意图目标" : "自动依赖"
  }));
}

function ChinesePensionIntentLab() {
  const [scenarioId, setScenarioId] = useState<PensionIntentScenarioId>("cash-access");
  const scenario = pensionIntentScenarios.find((item) => item.id === scenarioId) ?? pensionIntentScenarios[0];
  const taskPlan = buildPensionTaskPlan(scenario);
  const intentTargets = taskPlan.filter((stage) => stage.source === "意图目标").length;
  const dependencies = taskPlan.length - intentTargets;

  return (
    <section className="pension-lab" aria-label="中文养老金 Agentic Web 演示">
      <div className="pension-lab-head">
        <div>
          <span>Retirement Capability</span>
          <h2>同一套养老金能力，按意图动态组装界面和流程</h2>
        </div>
        <a href="/agentic-ui" className="pension-lab-link">
          <Route size={16} />
          <span>查看英文原型</span>
        </a>
      </div>

      <div className="pension-lab-switcher">
        {pensionIntentScenarios.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === scenario.id ? "active" : ""}
            onClick={() => setScenarioId(item.id)}
          >
            <strong>{item.label}</strong>
            <span>{item.prompt}</span>
          </button>
        ))}
      </div>

      <div className="pension-lab-grid">
        <aside className="pension-intent-card">
          <div className="pension-panel-title">
            <BrainCircuit size={17} />
            <span>意图解析</span>
          </div>
          <blockquote>{scenario.prompt}</blockquote>
          <dl>
            <div>
              <dt>业务意图</dt>
              <dd>{scenario.intent}</dd>
            </div>
            <div>
              <dt>任务模式</dt>
              <dd>{scenario.mode}</dd>
            </div>
            <div>
              <dt>目标解释</dt>
              <dd>{scenario.goal}</dd>
            </div>
          </dl>
        </aside>

        <section className="pension-workspace" aria-live="polite">
          <div className="pension-workspace-head">
            <div>
              <span>{scenario.workspaceHint}</span>
              <h3>{scenario.workspaceTitle}</h3>
            </div>
            <strong>动态渲染</strong>
          </div>

          <div className="pension-member-strip">
            <article>
              <span>客户</span>
              <strong>陈女士</strong>
            </article>
            <article>
              <span>养老金余额</span>
              <strong>¥680,000</strong>
            </article>
            <article>
              <span>系统已知</span>
              <strong>年龄 / 账户 / 身份</strong>
            </article>
          </div>

          {scenario.id === "cash-access" ? <PensionCashAccessWorkspace /> : <PensionRetirementChoiceWorkspace />}
        </section>

        <aside className="pension-plan-card">
          <div className="pension-panel-title">
            <GitBranch size={17} />
            <span>Task Plan</span>
          </div>
          <div className="pension-plan-stats">
            <div>
              <span>意图命中</span>
              <strong>{intentTargets}</strong>
            </div>
            <div>
              <span>自动补全</span>
              <strong>{dependencies}</strong>
            </div>
          </div>
          <ol className="pension-stage-list">
            {taskPlan.map((stage, index) => (
              <li key={stage.id} className={stage.source === "意图目标" ? "target" : ""}>
                <span>{index + 1}</span>
                <div>
                  <strong>{stage.title}</strong>
                  <p>{stage.microWorkflow}</p>
                  <small>{stage.source} · {stage.component}</small>
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </section>
  );
}

function PensionCashAccessWorkspace({
  result = {},
  setFlowState
}: {
  result?: Record<string, unknown>;
  setFlowState?: React.Dispatch<React.SetStateAction<PensionFlowState>>;
}) {
  const eligibility = result.withdrawal_eligibility as Record<string, unknown> | undefined;
  const impact = result.withdrawal_impact as Record<string, unknown> | undefined;
  const limitCheck = result.limit_check as Record<string, unknown> | undefined;
  const member = result.member_context as Record<string, unknown> | undefined;
  const portfolio = result.pension_portfolio as Record<string, unknown> | undefined;
  const routes = Array.isArray(eligibility?.routes) ? eligibility.routes as Array<Record<string, unknown>> : [];
  const routeOptions = routes.length ? routes : [
    { label: "住房公积金提取", maximum_amount: "¥120,000", required_evidence: ["主要住房声明", "贷款余额证明"], manual_review_required: false },
    { label: "困难救济提取", maximum_amount: "¥50,000", required_evidence: ["经济困难证明", "收入变化说明"], manual_review_required: true }
  ];
  const [selectedRoute, setSelectedRoute] = useState(String(routeOptions[0]?.label ?? ""));
  const selectedRouteRecord = routeOptions.find((route) => String(route.label) === selectedRoute) ?? routeOptions[0];
  const routeHint = selectedPensionRouteHint(selectedRoute);
  const blockedByLimit = limitCheck?.status === "blocked";
  const requestedAmountValue = parseYuanAmount(impact?.requested_amount) ?? 100000;
  const routeMaxAmount = parseYuanAmount(selectedRouteRecord?.maximum_amount);
  const amountCappedByRoute = Number.isFinite(routeMaxAmount) && requestedAmountValue > Number(routeMaxAmount);
  const effectiveAmountValue = blockedByLimit
    ? requestedAmountValue
    : amountCappedByRoute
      ? Number(routeMaxAmount)
      : requestedAmountValue;
  const requestedAmount = formatYuanAmount(effectiveAmountValue);
  const originalRequestedAmount = formatYuanAmount(requestedAmountValue);
  const estimatedNet = amountCappedByRoute
    ? estimateNetRange(effectiveAmountValue)
    : String(impact?.estimated_net ?? "¥92,000 - ¥95,000");
  return (
    <>
      <section className="pension-outcome-card">
        <div>
          <span>你的目标</span>
          <h3>从公积金账户提取 {requestedAmount}</h3>
          <p>{blockedByLimit ? "系统已经替你检查可行路径，但目标金额超过当前政策上限，不能继续提交申请。" : "系统已经替你读取账户、匹配可行路径并完成到账估算。现在还没有提交申请。"}</p>
        </div>
        <div className="pension-outcome-amount">
          <span>{blockedByLimit ? "当前状态" : "预计到账"}</span>
          <strong>{blockedByLimit ? "无法继续" : estimatedNet}</strong>
          <small>{blockedByLimit ? `最高可申请 ${String(limitCheck?.maximum_supported_amount ?? "¥120,000")}` : "收款账户：已验证"}</small>
        </div>
      </section>

      {blockedByLimit ? (
        <section className="pension-limit-block">
          <ShieldAlert size={20} />
          <div>
            <strong>目标金额超过所有可行路径上限</strong>
            <p>
              你输入的是 {String(limitCheck?.requested_amount ?? originalRequestedAmount)}，
              当前最高可申请 {String(limitCheck?.maximum_supported_amount ?? "¥120,000")}。
              请在右侧把金额改到上限以内，或先查看可行路径。
            </p>
          </div>
        </section>
      ) : null}

      <section className="pension-business-section">
        <div className="pension-section-head">
          <div>
            <span>系统已为你准备好</span>
            <h4>不用重新找入口、查规则、填重复资料</h4>
          </div>
          <ShieldCheck size={19} />
        </div>
        <div className="pension-readiness-grid">
          <article>
            <span>账户余额</span>
            <strong>{String(portfolio?.total_balance ?? "¥680,000")}</strong>
            <p>已自动读取，不再询问账户信息。</p>
          </article>
          <article>
            <span>身份状态</span>
            <strong>{member?.identity_status === "verified" ? "已验证" : "待验证"}</strong>
            <p>正式提交前仍会进行强身份确认。</p>
          </article>
          <article>
            <span>可行路径</span>
            <strong>{routeOptions.length} 个</strong>
            <p>系统只保留与你目标相关的路径。</p>
          </article>
        </div>
      </section>

      <section className="pension-business-section">
        <div className="pension-section-head">
          <div>
            <span>需要你亲自判断</span>
            <h4>选择真实用途，系统会据此裁剪后续流程</h4>
          </div>
          <ClipboardList size={19} />
        </div>
        <div className="pension-route-grid">
          {routeOptions.map((route) => (
            <button
              type="button"
              className={String(route.label) === selectedRoute ? "ready selected" : ""}
              key={String(route.label)}
              onClick={() => {
                const routeLabel = String(route.label);
                setSelectedRoute(routeLabel);
                setFlowState?.((current) => ({
                  ...current,
                  stage: "purpose",
                  selectedAction: "confirm_withdrawal_reason",
                  selectedRouteLabel: routeLabel,
                  routeMaxAmount: parseYuanAmount(route.maximum_amount)
                }));
              }}
            >
              <span>{route.manual_review_required ? "需要人工审核" : "可继续探索"}</span>
              <strong>{String(route.label)}</strong>
              <p>最高 {String(route.maximum_amount)} · {Array.isArray(route.required_evidence) ? route.required_evidence.join("、") : "需要补充材料"}</p>
            </button>
          ))}
        </div>
        <div className="pension-selected-note">
          <div>
            <strong>已选择：{selectedRoute}</strong>
            <span>{routeHint.emphasis}</span>
            {amountCappedByRoute ? <span>原目标 {originalRequestedAmount} 超过该路径上限，后续申请将按 {requestedAmount} 继续。</span> : null}
          </div>
          {setFlowState && !blockedByLimit ? (
            <button
              type="button"
              onClick={() => setFlowState({
                selectedAction: "start_controlled_application",
                stage: "application",
                selectedRouteLabel: selectedRoute,
                routeMaxAmount
              })}
            >
              用这个用途继续
            </button>
          ) : null}
        </div>
      </section>

      <section className="pension-business-section">
        <div className="pension-section-head">
          <div>
            <span>提取 {requestedAmount} 的结果</span>
            <h4>先看到账金额和长期影响，再决定是否申请</h4>
          </div>
          <Gauge size={19} />
        </div>
        <div className="pension-impact-grid">
          <article>
            <span>预计到账</span>
            <strong>{estimatedNet}</strong>
          </article>
          <article>
            <span>长期权益影响</span>
            <strong>-{String(impact?.monthly_income_reduction ?? "¥620")}</strong>
          </article>
          <article>
            <span>预计处理</span>
            <strong>3-5 个工作日</strong>
          </article>
        </div>
        <p className="pension-section-note">
          {routeHint.detail}
          {selectedRouteRecord?.manual_review_required ? " 这个方向通常会多一步材料审核。" : " 如果资料已在系统中，后续步骤会自动跳过重复填写。"}
        </p>
      </section>
    </>
  );
}

function PensionRetirementChoiceWorkspace({ result = {} }: { result?: Record<string, unknown> }) {
  const retirementOptions = result.retirement_options as Record<string, unknown> | undefined;
  const options = Array.isArray(retirementOptions?.options)
    ? retirementOptions.options as Array<Record<string, unknown>>
    : [
        { retirement_age: 60, estimated_monthly_income: "¥2,900", fit_score: "74%" },
        { retirement_age: 63, estimated_monthly_income: "¥3,300", fit_score: "86%" },
        { retirement_age: 65, estimated_monthly_income: "¥3,600", fit_score: "96%" }
      ];
  const strategies = Array.isArray(retirementOptions?.claim_strategies)
    ? retirementOptions.claim_strategies as Array<Record<string, unknown>>
    : [
        { label: "按月领取", summary: "适合希望收入稳定、减少一次性支出风险的用户。" },
        { label: "部分一次性 + 月领", summary: "适合需要先偿还大额支出，同时保留长期收入的用户。" }
      ];
  const [selectedAge, setSelectedAge] = useState(String(options[0]?.retirement_age ?? 60));
  const [selectedStrategy, setSelectedStrategy] = useState(String(strategies[0]?.label ?? "按月领取"));

  return (
    <>
      <section className="pension-business-section">
        <div className="pension-section-head">
          <div>
            <span>退休时间线</span>
            <h4>同一能力转成规划界面，而不是提取表单</h4>
          </div>
          <BarChart3 size={19} />
        </div>
        <div className="pension-timeline">
          {options.map((option) => (
            <button
              type="button"
              className={String(option.retirement_age) === selectedAge ? "selected" : ""}
              key={String(option.retirement_age)}
              onClick={() => setSelectedAge(String(option.retirement_age))}
            >
              <div>
                <strong>{String(option.retirement_age)} 岁</strong>
                <span>预计月领 {String(option.estimated_monthly_income)}</span>
              </div>
              <div className="pension-timeline-bar">
                <span style={{ width: String(option.fit_score ?? "74%") }} />
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="pension-business-section">
        <div className="pension-section-head">
          <div>
            <span>领取策略</span>
            <h4>比较领取方式，等待用户明确办理</h4>
          </div>
          <ClipboardList size={19} />
        </div>
        <div className="pension-route-grid">
          {strategies.map((strategy, index) => (
            <button
              type="button"
              className={`${index === 0 ? "ready" : ""} ${String(strategy.label) === selectedStrategy ? "selected" : ""}`}
              key={String(strategy.label)}
              onClick={() => setSelectedStrategy(String(strategy.label))}
            >
              <span>{index === 0 ? "稳定现金流" : "灵活资金"}</span>
              <strong>{String(strategy.label)}</strong>
              <p>{String(strategy.summary)}</p>
            </button>
          ))}
        </div>
        <div className="pension-selected-note">
          <strong>当前比较：{selectedAge} 岁退休 · {selectedStrategy}</strong>
          <span>这里只是规划测算；用户明确办理前，不会进入领取申请。</span>
        </div>
      </section>
    </>
  );
}

function PensionNextActions({
  result = {},
  flowState,
  setFlowState
}: {
  result?: Record<string, unknown>;
  flowState: PensionFlowState;
  setFlowState: React.Dispatch<React.SetStateAction<PensionFlowState>>;
}) {
  const actions = Array.isArray(result.next_actions) ? result.next_actions as Array<Record<string, unknown>> : [];
  if (!actions.length) return null;

  const labels: Record<string, { title: string; detail: string }> = {
    confirm_withdrawal_reason: {
      title: "确认提取原因",
      detail: "继续收敛到住房相关提取、困难救济或仅咨询。"
    },
    compare_lower_impact_options: {
      title: "比较低影响方案",
      detail: "先比较少取、分期取或暂不提取的影响。"
    },
    start_controlled_application: {
      title: "进入受控申请",
      detail: "需要条款确认、身份验证和最终授权。"
    },
    choose_retirement_age_to_compare: {
      title: "选择退休年龄",
      detail: "聚焦比较 60、63、65 岁等退休窗口。"
    },
    choose_claim_strategy: {
      title: "选择领取方式",
      detail: "比较按月领取和部分一次性领取。"
    },
    start_controlled_claim_application: {
      title: "进入领取申请",
      detail: "只有明确授权后才创建正式申请。"
    },
    reduce_requested_amount: {
      title: "降低申请金额",
      detail: "把金额改到当前最高可申请额度以内。"
    },
    compare_available_routes: {
      title: "查看可行路径",
      detail: "先看每种提取路径的最高金额和材料要求。"
    }
  };

  return (
    <section className="pension-business-section pension-next-actions">
      <div className="pension-section-head">
        <div>
          <span>可选择下一步</span>
          <h4>选择你想继续看的方向</h4>
        </div>
        <GitBranch size={19} />
      </div>
      <div className="pension-action-grid">
        {actions.map((action, index) => {
          const actionId = String(action.action ?? action.id ?? "next_action");
          const text = labels[actionId] ?? {
            title: actionId.replaceAll("_", " "),
            detail: "继续这个受控业务动作。"
          };
          const gated = Boolean(action.requires_explicit_authorization || action.required);
          const selected = flowState.selectedAction === actionId || (!flowState.selectedAction && index === 0);
          return (
            <button
              type="button"
              className={`${gated ? "gated" : ""} ${selected ? "selected" : ""}`}
              key={actionId}
              onClick={() => setFlowState((current) => ({
                ...current,
                selectedAction: actionId,
                stage: actionId === "compare_lower_impact_options" || actionId === "compare_available_routes"
                  ? "compare"
                  : actionId === "start_controlled_application"
                    ? "application"
                    : "purpose"
              }))}
            >
              <span>{gated ? "需确认" : "建议"}</span>
              <strong>{text.title}</strong>
              <small>{text.detail}</small>
            </button>
          );
        })}
      </div>
      <p className="pension-section-note">
        这些选择会继续缩小任务范围；只有进入受控申请后，才会出现条款确认、身份验证和最终授权。
      </p>
      <PensionActionDetail
        actionId={flowState.selectedAction || String(actions[0]?.action ?? actions[0]?.id ?? "")}
        result={result}
        flowState={flowState}
        flowStage={flowState.stage}
        setFlowState={setFlowState}
      />
    </section>
  );
}

function PensionActionDetail({
  actionId,
  result,
  flowState,
  flowStage,
  setFlowState
}: {
  actionId: string;
  result: Record<string, unknown>;
  flowState: PensionFlowState;
  flowStage: PensionFlowState["stage"];
  setFlowState: React.Dispatch<React.SetStateAction<PensionFlowState>>;
}) {
  const impact = result.withdrawal_impact as Record<string, unknown> | undefined;
  const limitCheck = result.limit_check as Record<string, unknown> | undefined;
  const blockedByLimit = limitCheck?.status === "blocked";
  const requestedAmountValue = parseYuanAmount(impact?.requested_amount) ?? 100000;
  const routeMaxAmount = flowState.routeMaxAmount;
  const cappedByRoute = Number.isFinite(routeMaxAmount) && requestedAmountValue > Number(routeMaxAmount);
  const effectiveAmount = cappedByRoute ? Number(routeMaxAmount) : requestedAmountValue;
  const amount = formatYuanAmount(effectiveAmount);
  const originalAmount = formatYuanAmount(requestedAmountValue);
  const net = cappedByRoute ? estimateNetRange(effectiveAmount) : String(impact?.estimated_net ?? "¥92,000 - ¥95,000");

  if (blockedByLimit) {
    return (
      <div className="pension-flow-panel blocked">
        <div>
          <span>申请被策略阻断</span>
          <h4>不能继续进入条款确认或身份验证</h4>
          <p className="pension-section-note">
            当前目标金额 {String(limitCheck?.requested_amount ?? formatYuanAmount(requestedAmountValue))} 超过最高可申请额度
            {String(limitCheck?.maximum_supported_amount ?? "¥120,000")}。请先在右侧修改金额。
          </p>
        </div>
      </div>
    );
  }

  if (actionId === "compare_lower_impact_options") {
    return (
      <div className="pension-flow-panel">
        <div>
          <span>已生成比较方案</span>
          <h4>系统把“直接取 {amount}”拆成 3 个可比较选择</h4>
        </div>
        <div className="pension-option-compare">
          <button type="button" onClick={() => setFlowState((current) => ({ ...current, selectedAction: "start_controlled_application", stage: "application" }))}>
            <span>当前方案</span>
            <strong>提取 {amount}</strong>
            <p>预计到账 {net}，最快进入申请。</p>
          </button>
          <button type="button" onClick={() => setFlowState((current) => ({ ...current, selectedAction: "start_controlled_application", stage: "application" }))}>
            <span>低影响方案</span>
            <strong>先取一半</strong>
            <p>降低长期权益影响，保留后续再申请空间。</p>
          </button>
          <button type="button" onClick={() => setFlowState((current) => ({ ...current, selectedAction: "confirm_withdrawal_reason", stage: "decision" }))}>
            <span>替代方案</span>
            <strong>暂不提交</strong>
            <p>保存测算结果，之后继续比较。</p>
          </button>
        </div>
      </div>
    );
  }

  if (actionId === "start_controlled_application") {
    return (
      <div className="pension-flow-panel">
        <div>
          <span>受控申请流程已组装</span>
          <h4>现在开始才会进入正式办理路径</h4>
          {cappedByRoute ? <p className="pension-section-note">你原本想提取 {originalAmount}，但当前路径最高可申请 {amount}，流程已按上限金额继续。</p> : null}
        </div>
        <ol className="pension-application-flow">
          <li className="done"><strong>目标和金额</strong><span>提取 {amount}，预计到账 {net}</span></li>
          <li className="done"><strong>可行路径</strong><span>住房公积金提取优先，困难救济作为备选</span></li>
          <li className={flowStage === "application" ? "current" : "done"}><strong>条款确认</strong><span>确认用途、材料真实性和到账金额可能变化</span></li>
          <li className={flowStage === "identity" ? "current" : flowStage === "authorization" || flowStage === "submitted" ? "done" : ""}><strong>身份验证</strong><span>强身份校验后才允许提交</span></li>
          <li className={flowStage === "authorization" ? "current" : flowStage === "submitted" ? "done" : ""}><strong>最终授权</strong><span>用户确认后才创建正式申请</span></li>
        </ol>
        <div className="pension-flow-actions">
          {flowStage === "application" ? (
            <button type="button" onClick={() => setFlowState((current) => ({ ...current, selectedAction: "start_controlled_application", stage: "identity" }))}>确认条款，继续身份验证</button>
          ) : null}
          {flowStage === "identity" ? (
            <button type="button" onClick={() => setFlowState((current) => ({ ...current, selectedAction: "start_controlled_application", stage: "authorization" }))}>身份验证通过，查看最终授权</button>
          ) : null}
          {flowStage === "authorization" ? (
            <button type="button" onClick={() => setFlowState((current) => ({ ...current, selectedAction: "start_controlled_application", stage: "submitted" }))}>确认并提交申请</button>
          ) : null}
          {flowStage === "submitted" ? <strong className="pension-submit-result">申请已创建，预计 3-5 个工作日处理。</strong> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="pension-flow-panel">
      <div>
        <span>下一步已收敛</span>
        <h4>先确认真实用途，再自动裁剪材料和审核步骤</h4>
      </div>
      <ol className="pension-application-flow compact">
        <li className="current"><button type="button" onClick={() => setFlowState((current) => ({ ...current, selectedAction: "start_controlled_application", stage: "application" }))}><strong>住房用途</strong><span>房贷、租房或主要住房相关资金需求</span></button></li>
        <li><button type="button" onClick={() => setFlowState((current) => ({ ...current, selectedAction: "start_controlled_application", stage: "application", selectedRouteLabel: "困难救济提取", routeMaxAmount: 50000 }))}><strong>困难救济</strong><span>收入变化、医疗或短期生活困难</span></button></li>
        <li><button type="button" onClick={() => setFlowState((current) => ({ ...current, selectedAction: "confirm_withdrawal_reason", stage: "decision" }))}><strong>仅咨询</strong><span>保存测算，不创建申请</span></button></li>
      </ol>
    </div>
  );
}

function extractRetirementAgeFromPrompt(prompt: string) {
  const patterns = [
    /\bretire(?:ment)?\s*(?:at|age)?\s*(\d{2,3})\b/i,
    /\bage\s*(\d{2,3})\s*(?:retire|retirement)\b/i,
    /(\d{2,3})\s*岁\s*(?:退休|retire)/i,
    /(?:退休|retire)\s*(?:到|在|at)?\s*(\d{2,3})\s*岁?/i
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (!match) continue;
    const age = Number(match[1]);
    if (Number.isFinite(age)) return age;
  }

  return undefined;
}

function extractContributionRateFromPrompt(prompt: string) {
  const match = prompt.match(/\b(\d{1,3}(?:\.\d+)?)\s*(?:%|percent\b|per cent\b)/i);
  if (!match) return undefined;
  const rate = Number(match[1]);
  return Number.isFinite(rate) ? rate : undefined;
}

function extractWithdrawalAmountFromPrompt(prompt: string) {
  const match = prompt.match(
    /[£¥]\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?|(\d+(?:\.\d+)?)\s*(?:万|萬元|万元)|([一二两三四五六七八九十]+)\s*(?:万|萬元|万元)|\b(\d{4,7})\b/
  );
  const chineseWan = match?.[3];
  if (chineseWan) {
    const parsed = parseSmallChineseNumber(chineseWan);
    return Number.isFinite(parsed) ? parsed * 10000 : undefined;
  }
  const raw = match?.[1] ?? match?.[2] ?? match?.[4];
  if (!raw) return undefined;
  const value = Number(raw.replaceAll(",", ""));
  if (!Number.isFinite(value)) return undefined;
  return match?.[2] ? value * 10000 : value;
}

function parseSmallChineseNumber(value: string) {
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  };
  if (value === "十") return 10;
  if (value.includes("十")) {
    const [tens, ones] = value.split("十");
    return (tens ? digits[tens] ?? 1 : 1) * 10 + (ones ? digits[ones] ?? 0 : 0);
  }
  return digits[value] ?? Number.NaN;
}

function AgenticWebPage() {
  const [activeWorkflowId, setActiveWorkflowId] = useState(() => defaultAgenticWorkflow.id);
  const activeWorkflow = workflowById.get(activeWorkflowId) ?? defaultAgenticWorkflow;
  const [renderedWorkflowId, setRenderedWorkflowId] = useState(activeWorkflow.id);
  const renderedWorkflow = workflowById.get(renderedWorkflowId) ?? defaultAgenticWorkflow;
  const [prompt, setPrompt] = useState(() => activeWorkflow.prompt);
  const assistantTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const chatHistoryRef = useRef<HTMLDivElement | null>(null);
  const layoutTransitionTimerRef = useRef<number | undefined>(undefined);
  const [response, setResponse] = useState<AgentResponse | null>(null);
  const [audit, setAudit] = useState<AuditRecord | null>(null);
  const [events, setEvents] = useState<AguiRunEvent[]>([]);
  const [conversation, setConversation] = useState<AgenticChatTurn[]>([]);
  const [condensedIntent, setCondensedIntent] = useState(activeWorkflow.title);
  const [loading, setLoading] = useState(false);
  const [workflowActionLoading, setWorkflowActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [workspaceStarted, setWorkspaceStarted] = useState(false);
  const [layoutEngaged, setLayoutEngaged] = useState(false);
  const [layoutTransitioning, setLayoutTransitioning] = useState(false);
  const [workflowRun, setWorkflowRun] = useState<WorkflowRun | null>(null);
  const [subscriptionAmount, setSubscriptionAmount] = useState(8000);
  const [contributionRate, setContributionRate] = useState(10);
  const [retirementAge, setRetirementAge] = useState(65);
  const [withdrawalAmount, setWithdrawalAmount] = useState(100000);
  const [pensionFlowState, setPensionFlowState] = useState<PensionFlowState>({
    stage: "decision",
    selectedAction: "confirm_withdrawal_reason"
  });

  const currentPrompt = prompt;
  const hasRun = workspaceStarted || Boolean(response || loading || error);
  const shellClassName = layoutEngaged
    ? "agentic-shell engaged"
    : layoutTransitioning
      ? "agentic-shell transitioning"
      : "agentic-shell";
  useEffect(() => {
    window.scrollTo({ left: 0, top: window.scrollY });
  }, []);

  useEffect(() => {
    window.localStorage.setItem("agentic.activeWorkflowId", activeWorkflowId);
    if (currentPrompt) {
      window.localStorage.setItem("agentic.prompt", currentPrompt);
    } else {
      window.localStorage.removeItem("agentic.prompt");
    }
  }, [activeWorkflowId, currentPrompt]);

  useEffect(() => {
    if (!workspaceStarted) {
      setCondensedIntent(activeWorkflow.title);
      setPrompt(activeWorkflow.prompt);
    }
  }, [activeWorkflow, workspaceStarted]);

  useEffect(() => {
    const node = chatHistoryRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [conversation, loading]);

  useEffect(() => {
    return () => {
      if (layoutTransitionTimerRef.current) {
        window.clearTimeout(layoutTransitionTimerRef.current);
      }
    };
  }, []);

  function chooseWorkflow(workflow: AgenticWorkflow) {
    setActiveWorkflowId(workflow.id);
    setPrompt(workflow.prompt);
    if (workflow.id === "pension-cash-access") {
      setWithdrawalAmount(Number(workflow.input.requestedWithdrawalAmount ?? 100000));
    }
    window.requestAnimationFrame(() => assistantTextareaRef.current?.focus());
  }

  function clearConversationHistory() {
    setConversation([]);
    setPrompt("");
    setCondensedIntent(renderedWorkflow.title);
    window.requestAnimationFrame(() => assistantTextareaRef.current?.focus());
  }

  async function submitAgenticRequest(event?: React.FormEvent) {
    event?.preventDefault();
    const question = currentPrompt.trim();
    if (!question) return;

    const priorConversation = conversation;
    const promptWithdrawalAmount = extractWithdrawalAmountFromPrompt(question);
    const workflowSignal = inferWorkflowFromConversation(question, activeWorkflow);
    const hasExplicitWorkflowSignal = Boolean(workflowSignal);
    const shouldContinueCurrentWorkflow = !hasExplicitWorkflowSignal && workspaceStarted && Boolean(promptWithdrawalAmount);
    const inferredWorkflow = workflowSignal?.workflow ?? (shouldContinueCurrentWorkflow ? renderedWorkflow : activeWorkflow);
    const shouldInvokeWorkflow = hasExplicitWorkflowSignal || shouldContinueCurrentWorkflow;
    const nextCondensedIntent = shouldInvokeWorkflow
      ? buildCondensedIntent(priorConversation, question, inferredWorkflow)
      : "需要更多信息才能选择业务";
    const conversationPrompt = buildConversationPrompt(priorConversation, question, nextCondensedIntent);
    const desiredContribution = Number(inferredWorkflow.input.desiredContributionRate ?? 10);
    const desiredRetirementAge = Number(inferredWorkflow.input.targetRetirementAge ?? 65);
    const promptContribution = extractContributionRateFromPrompt(conversationPrompt);
    const promptRetirementAge = extractRetirementAgeFromPrompt(conversationPrompt);
    const isRerunOfCurrentWorkflow = workspaceStarted && inferredWorkflow.id === renderedWorkflowId;
    const submittedContribution = isRerunOfCurrentWorkflow ? contributionRate : (promptContribution ?? desiredContribution);
    const submittedRetirementAge = isRerunOfCurrentWorkflow ? retirementAge : (promptRetirementAge ?? desiredRetirementAge);
    const submittedWithdrawalAmount = inferredWorkflow.id === "pension-cash-access"
      ? promptWithdrawalAmount ?? (isRerunOfCurrentWorkflow ? withdrawalAmount : Number(inferredWorkflow.input.requestedWithdrawalAmount ?? 100000))
      : withdrawalAmount;
    const userTurn: AgenticChatTurn = {
      id: `user-${Date.now()}`,
      role: "user",
      text: question,
      intent: nextCondensedIntent,
      workflowId: inferredWorkflow.id,
      timestamp: new Date().toISOString()
    };
    setConversation((current) => [...current, userTurn]);
    if (shouldInvokeWorkflow) {
      setActiveWorkflowId(inferredWorkflow.id);
      setRenderedWorkflowId(inferredWorkflow.id);
    }
    setCondensedIntent(nextCondensedIntent);
    setWorkspaceStarted(true);
    if (shouldInvokeWorkflow && inferredWorkflow.id === "pension-cash-access") {
      setPensionFlowState({ stage: "decision", selectedAction: "confirm_withdrawal_reason" });
    }
    if (!layoutEngaged) {
      setLayoutTransitioning(true);
      if (layoutTransitionTimerRef.current) {
        window.clearTimeout(layoutTransitionTimerRef.current);
      }
      layoutTransitionTimerRef.current = window.setTimeout(() => {
        setLayoutEngaged(true);
        setLayoutTransitioning(false);
      }, 260);
    }
    setWorkflowRun(null);
    setPrompt("");
    if (shouldInvokeWorkflow && inferredWorkflow.id === "isa-top-up-readiness") setSubscriptionAmount(8000);
    if (shouldInvokeWorkflow && inferredWorkflow.domain === "Workplace Investing") {
      setContributionRate(Number.isFinite(submittedContribution) ? submittedContribution : 10);
      setRetirementAge(Number.isFinite(submittedRetirementAge) ? submittedRetirementAge : 65);
    }
    if (shouldInvokeWorkflow && inferredWorkflow.id === "pension-cash-access" && Number.isFinite(submittedWithdrawalAmount)) {
      setWithdrawalAmount(submittedWithdrawalAmount);
    }
    setLoading(true);
    setError("");
    setAudit(null);
    setResponse(null);
    setEvents([]);

    try {
      if (isLocalPensionWorkflow(inferredWorkflow)) {
        const data = createLocalPensionAgentResponse(inferredWorkflow, conversationPrompt);
        setEvents([
          {
            id: "local-pension-intent",
            type: "RUN_STARTED",
            label: "Resolve Chinese pension intent",
            detail: "Task Plan assembled from controlled stage registry.",
            status: "completed"
          },
          {
            id: "local-pension-render",
            type: "TOOL_RESULT",
            label: "Render dynamic workspace",
            detail: "Presentation selected from the task plan, not a fixed page route.",
            status: "completed"
          }
        ]);
        setResponse(data);
        setWorkflowRun(data.workflowRun ?? null);
        setConversation((current) => [
          ...current,
          {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            text: data.result?.summary ?? data.resolution.reasoning,
            intent: data.resolution.intent ?? nextCondensedIntent,
            workflowId: inferredWorkflow.id,
            timestamp: new Date().toISOString(),
            status: data.resolution.status
          }
        ]);
        setAudit(null);
        return;
      }

      const input = shouldInvokeWorkflow
        ? {
            ...inferredWorkflow.input,
            microWorkflowId: inferredWorkflow.microWorkflow,
            ...(inferredWorkflow.id === "isa-top-up-readiness" ? { plannedIsaSubscription: subscriptionAmount } : {}),
            ...(inferredWorkflow.domain === "Workplace Investing" ? {
              desiredContributionRate: submittedContribution,
              targetRetirementAge: submittedRetirementAge
            } : {}),
            ...(inferredWorkflow.id === "pension-cash-access" ? { requestedWithdrawalAmount: submittedWithdrawalAmount } : {})
          }
        : {
            customerId: String(inferredWorkflow.input.customerId ?? "CN001")
          };
      const data = await runAguiRequest(
        {
          ...input,
          prompt: conversationPrompt
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
      setConversation((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          text: data.result?.summary ?? data.resolution.reasoning,
          intent: data.resolution.intent ?? nextCondensedIntent,
          workflowId: inferredWorkflow.id,
          timestamp: new Date().toISOString(),
          status: data.resolution.status
        }
      ]);

      const nextAudit = data.result?.audit_trace_id
        ? await fetch(`${gatewayBaseUrl}/audit/${data.result.audit_trace_id}`)
            .then((auditRes) => auditRes.ok ? auditRes.json() as Promise<AuditRecord> : null)
            .catch(() => null)
        : null;
      setAudit(nextAudit);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed");
      setConversation((current) => [
        ...current,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          text: caught instanceof Error ? caught.message : "Request failed",
          intent: nextCondensedIntent,
          workflowId: inferredWorkflow.id,
          timestamp: new Date().toISOString(),
          status: "unsupported"
        }
      ]);
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
    <main className={shellClassName}>
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
        <section className="agentic-main">
          {!layoutEngaged ? (
            <div className="agentic-start">
              <form className="agentic-compose hero-compose initial-compose" onSubmit={(event) => void submitAgenticRequest(event)}>
                <textarea
                  value={currentPrompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Ask as a client, member, or adviser..."
                  aria-label="Agentic question"
                />
                <button className="agentic-send" type="submit" disabled={loading || !currentPrompt.trim()}>
                  {loading ? <Loader2 className="spin" size={18} /> : <SendHorizontal size={18} />}
                  <span>Generate</span>
                </button>
              </form>
            </div>
          ) : (
            <>
              <div className="agentic-result-head">
                <div>
                  <span>{hasIntentBoundary ? "Intent boundary" : "Generated business workspace"}</span>
                  <h1>{hasIntentBoundary ? "Request recognised" : renderedWorkflow.title}</h1>
                </div>
                <div className="surface-meta">
                  {isPensionWorkflow(renderedWorkflow) && !hasIntentBoundary ? (
                    <>
                      <span>会员服务</span>
                      <span>{loading ? "正在准备" : "方案已准备"}</span>
                      <span>未提交申请</span>
                    </>
                  ) : (
                    <>
                      <span>{hasIntentBoundary ? response?.resolution.intent ?? "outside catalog" : renderedWorkflow.audience}</span>
                      <span>{response?.resolution.status ?? (loading ? "composing" : "ready")}</span>
                      {!hasIntentBoundary ? <span>{renderedWorkflow.microWorkflow.replaceAll("_", " ")}</span> : null}
                      {workflowRun ? <span>plan v{workflowRun.agent.planVersion}</span> : null}
                    </>
                  )}
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
                  <MicroWorkflowProgress workflow={renderedWorkflow} run={workflowRun} pensionFlowStage={pensionFlowState.stage} />
                  {!isPensionWorkflow(renderedWorkflow) ? <AgentWorkBrief run={workflowRun} loading={loading} /> : null}
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
                    pensionFlowState={pensionFlowState}
                    setPensionFlowState={setPensionFlowState}
                  />
                </>
              )}
            </>
          )}
        </section>

        <aside className="agentic-assistant-panel">
          <div className="assistant-panel-head">
            <div>
              <span>Conversation</span>
              <strong>Intent narrows as the thread continues</strong>
            </div>
            <button
              type="button"
              className="new-conversation-button"
              onClick={clearConversationHistory}
              aria-label="Clear conversation history"
              title="Clear conversation history"
            >
              <RotateCcw size={16} />
            </button>
          </div>

          <div className="intent-focus-card">
            <span>Condensed intent</span>
            <strong>{condensedIntent}</strong>
            <small>{activeWorkflow.domain} / {activeWorkflow.audience}</small>
          </div>

          <div className="agentic-chat-history" ref={chatHistoryRef} aria-live="polite">
            {conversation.length ? (
              conversation.map((turn) => (
                <article className={`agentic-chat-turn ${turn.role}`} key={turn.id}>
                  <div>
                    <span>{turn.role === "user" ? "You" : "Agent"}</span>
                    {turn.status ? <small>{turn.status.replaceAll("_", " ")}</small> : null}
                  </div>
                  <p>{turn.text}</p>
                  <em>{turn.intent}</em>
                </article>
              ))
            ) : (
              <div className="agentic-chat-empty">
                <BrainCircuit size={20} />
                <p>Start with a scenario or ask directly. Follow-up messages keep the same thread and refine the intent.</p>
              </div>
            )}
            {loading ? (
              <article className="agentic-chat-turn assistant thinking">
                <div>
                  <span>Agent</span>
                  <small>composing</small>
                </div>
                <p>Reading the latest turn against the running intent...</p>
              </article>
            ) : null}
          </div>

          <form className="agentic-compose compact chat-compose" onSubmit={(event) => void submitAgenticRequest(event)}>
            <label>
              <span>Continue the conversation</span>
              <textarea
                ref={assistantTextareaRef}
                value={currentPrompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Ask a follow-up or change the goal..."
              />
            </label>
            <button className="agentic-send" type="submit" disabled={loading || !currentPrompt.trim()}>
              {loading ? <Loader2 className="spin" size={18} /> : <SendHorizontal size={18} />}
              <span>{hasRun ? "Send follow-up" : "Generate workspace"}</span>
            </button>
          </form>

          <ScenarioModeStrip activeWorkflow={activeWorkflow} />

          <div className="agentic-question-list compact-list">
            {agenticWorkflows.map((workflow) => (
              <button
                key={workflow.id}
                type="button"
                className={workflow.id === activeWorkflowId ? "agentic-question active" : "agentic-question"}
                onClick={() => chooseWorkflow(workflow)}
                title="Copy this question to the input"
              >
                <strong>{workflow.label}</strong>
                <span>{workflow.narrative}</span>
                <small>{workflow.domain} / {workflow.audience}</small>
              </button>
            ))}
          </div>
        </aside>
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
    adviser_platform_model_portfolio_review: "Adviser portfolio review",
    retirement_pension_task_orchestration: "养老金任务编排"
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
  run,
  pensionFlowStage = "decision"
}: {
  workflow: AgenticWorkflow;
  run: WorkflowRun | null;
  pensionFlowStage?: PensionFlowState["stage"];
}) {
  const rawSteps = run?.steps ?? workflow.steps.map((step) => ({ ...step, status: "waiting" as const }));
  const pensionWorkflow = isPensionWorkflow(workflow);
  const pensionCurrentStep = pensionFlowStage === "application"
    ? 6
    : pensionFlowStage === "identity"
      ? 7
      : pensionFlowStage === "authorization" || pensionFlowStage === "submitted"
        ? 8
        : Math.max(0, rawSteps.length - 1);
  const steps = pensionWorkflow
    ? [
        ...rawSteps,
        ...(workflow.id === "pension-cash-access"
          ? [
              { label: "条款确认", detail: "确认用途、材料真实性和到账金额可能变化。", status: "waiting" as const },
              { label: "身份验证", detail: "强身份校验后才允许提交。", status: "waiting" as const },
              { label: "最终授权", detail: "用户确认后才创建正式申请。", status: "waiting" as const }
            ]
          : [])
      ].map((step, index) => ({
        ...step,
        status: index < pensionCurrentStep || pensionFlowStage === "submitted" ? "completed" as const : index === pensionCurrentStep ? "requires_action" as const : "waiting" as const
      }))
    : rawSteps;
  const currentStep = pensionWorkflow ? Math.min(pensionCurrentStep, steps.length - 1) : run?.currentStepIndex ?? 0;

  return (
    <nav className={pensionWorkflow ? "micro-workflow-progress customer-progress" : "micro-workflow-progress"} aria-label="Current business workflow">
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
  performWorkflowAction,
  pensionFlowState,
  setPensionFlowState
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
  pensionFlowState: PensionFlowState;
  setPensionFlowState: React.Dispatch<React.SetStateAction<PensionFlowState>>;
}) {
  const result = response?.result ?? {};
  const sourceApis = response?.result?.source_apis ?? workflow.apiPlan.map((api) => `${api} API`);
  const confidence = response ? Math.round(response.resolution.confidence * 100) : 0;
  const currentStep = workflowRun?.currentStepIndex ?? 0;
  const currentRunStep = workflowRun?.steps[currentStep];
  const pensionWorkflow = isPensionWorkflow(workflow);
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

      {!pensionWorkflow ? (
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
      ) : null}

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

      {!loading && workflow.id === "pension-cash-access" ? (
        <>
          <PensionCashAccessWorkspace result={result} setFlowState={setPensionFlowState} />
          <PensionNextActions result={result} flowState={pensionFlowState} setFlowState={setPensionFlowState} />
        </>
      ) : null}

      {!loading && workflow.id === "pension-retirement-choice" ? (
        <>
          <PensionRetirementChoiceWorkspace result={result} />
          <PensionNextActions result={result} flowState={pensionFlowState} setFlowState={setPensionFlowState} />
        </>
      ) : null}

      {!loading && workflowRun && !panelOwnsAction && !pensionWorkflow ? <div className="workflow-action-bar backend-action-bar">
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
        <input type="range" min="50" max="75" step="1" value={retirementAge} onChange={(event) => setRetirementAge(Number(event.target.value))} />
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
  window.location.pathname.startsWith("/agentic-ui")
    ? <AgenticUiPage />
    : window.location.pathname.startsWith("/agentic")
      ? <AgenticWebPage />
      : <App />
);
