import type { AuditEvent, AuditRecord, AuditStep, CapabilityId } from "@agent-bridge/shared";

const records = new Map<string, AuditRecord>();
const requestIndex = new Map<string, string>();

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function createEvent(args: Omit<AuditEvent, "id" | "timestamp">): AuditEvent {
  return {
    id: createId("EVT"),
    timestamp: new Date().toISOString(),
    ...args
  };
}

export function createAuditRecord(args: {
  capabilityId: CapabilityId;
  capabilityVersion: string;
  customerId: string;
  sourceApis: string[];
  policyChecks: AuditStep[];
  compositionSteps: AuditStep[];
}) {
  const traceId = createId("TRACE");
  const requestId = createId("REQ");
  const baseEvent = {
    traceId,
    requestId,
    capabilityId: args.capabilityId,
    customerId: args.customerId
  };
  const events: AuditEvent[] = [
    createEvent({
      ...baseEvent,
      type: "request.received",
      summary: `Gateway received invocation request for ${args.capabilityId}.`
    }),
    createEvent({
      ...baseEvent,
      type: "capability.invoked",
      summary: `Capability ${args.capabilityId}@${args.capabilityVersion} selected for execution.`
    }),
    ...args.policyChecks.map((check) =>
      createEvent({
        ...baseEvent,
        type: check.status === "denied" ? "request.denied" : "policy.checked",
        summary: `${check.name}: ${check.status}`,
        detail: check.detail,
        metadata: { check }
      })
    ),
    ...args.sourceApis.map((api) =>
      createEvent({
        ...baseEvent,
        type: "backend_api.called",
        summary: `${api} used by capability composition.`,
        metadata: { api }
      })
    ),
    ...args.compositionSteps.map((step) =>
      createEvent({
        ...baseEvent,
        type: "composition.completed",
        summary: `${step.name}: ${step.status}`,
        detail: step.detail,
        metadata: { step }
      })
    )
  ];

  if (args.policyChecks.some((check) => check.status === "requires_confirmation")) {
    events.push(
      createEvent({
        ...baseEvent,
        type: "confirmation.required",
        summary: "At least one next action is gated behind explicit confirmation."
      })
    );
  }

  events.push(
    createEvent({
      ...baseEvent,
      type: "result.returned",
      summary: `Agent-readable result returned with audit trace ${traceId}.`
    })
  );

  const record: AuditRecord = {
    traceId,
    requestId,
    capabilityId: args.capabilityId,
    capabilityVersion: args.capabilityVersion,
    customerId: args.customerId,
    startedAt: new Date().toISOString(),
    sourceApis: args.sourceApis,
    policyChecks: args.policyChecks,
    compositionSteps: args.compositionSteps,
    events
  };

  records.set(traceId, record);
  requestIndex.set(requestId, traceId);
  return record;
}

export function getAuditRecord(traceId: string) {
  return records.get(traceId);
}

export function getAuditEvents(traceId: string) {
  return records.get(traceId)?.events;
}

export function getAuditRecordByRequestId(requestId: string) {
  const traceId = requestIndex.get(requestId);
  return traceId ? records.get(traceId) : undefined;
}
