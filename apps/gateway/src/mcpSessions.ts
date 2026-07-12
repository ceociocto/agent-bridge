import type { CapabilityId, McpConversationSession, McpConversationStep } from "@agent-bridge/shared";

const sessions = new Map<string, McpConversationSession>();

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

export function recordMcpStep(args: {
  sessionId?: string;
  clientName?: string;
  actor: McpConversationStep["actor"];
  kind: McpConversationStep["kind"];
  name: string;
  status: McpConversationStep["status"];
  summary: string;
  traceId?: string;
  capabilityId?: CapabilityId;
  metadata?: Record<string, unknown>;
}) {
  const sessionId = args.sessionId || createId("MCP");
  const now = new Date().toISOString();
  const existing = sessions.get(sessionId);
  const step: McpConversationStep = {
    id: createId("STEP"),
    sessionId,
    timestamp: now,
    sequence: (existing?.steps.length ?? 0) + 1,
    actor: args.actor,
    kind: args.kind,
    name: args.name,
    status: args.status,
    summary: args.summary,
    traceId: args.traceId,
    capabilityId: args.capabilityId,
    metadata: args.metadata
  };

  const session: McpConversationSession = existing ?? {
    id: sessionId,
    clientName: args.clientName ?? "mcp-client",
    startedAt: now,
    updatedAt: now,
    status: "active",
    stepCount: 0,
    lastSummary: "",
    traceIds: [],
    capabilityIds: [],
    steps: []
  };

  session.updatedAt = now;
  session.status = args.status === "failed" ? "failed" : "active";
  session.lastSummary = args.summary;
  session.steps.push(step);
  session.stepCount = session.steps.length;
  session.traceIds = unique([...session.traceIds, ...(args.traceId ? [args.traceId] : [])]);
  session.capabilityIds = unique([
    ...session.capabilityIds,
    ...(args.capabilityId ? [args.capabilityId] : [])
  ]);

  sessions.set(sessionId, session);
  return { sessionId, step };
}

export function listMcpSessions(limit = 20) {
  return [...sessions.values()]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit)
    .map((session) => ({
      ...session,
      steps: session.steps.slice(-12)
    }));
}

export function getMcpSession(sessionId: string) {
  return sessions.get(sessionId);
}
