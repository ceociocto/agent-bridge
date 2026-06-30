import type { AuditRecord, AuditStep, CapabilityId } from "@agent-bridge/shared";

const records = new Map<string, AuditRecord>();

export function createAuditRecord(args: {
  capabilityId: CapabilityId;
  customerId: string;
  sourceApis: string[];
  policyChecks: AuditStep[];
  compositionSteps: AuditStep[];
}) {
  const traceId = `TRACE-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const record: AuditRecord = {
    traceId,
    capabilityId: args.capabilityId,
    customerId: args.customerId,
    startedAt: new Date().toISOString(),
    sourceApis: args.sourceApis,
    policyChecks: args.policyChecks,
    compositionSteps: args.compositionSteps
  };

  records.set(traceId, record);
  return record;
}

export function getAuditRecord(traceId: string) {
  return records.get(traceId);
}
