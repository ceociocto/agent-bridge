import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CapabilityId, IntentResolution } from "@agent-bridge/shared";
import { resolveIntent } from "./intent.js";

type RouterEvalCase = {
  id: string;
  businessLine: string;
  input: string;
  expectedStatus: IntentResolution["status"];
  expectedCapabilityId?: CapabilityId;
  expectedPolicyName?: string;
};

type CaseResult = {
  id: string;
  businessLine: string;
  passed: boolean;
  expected: {
    status: IntentResolution["status"];
    capabilityId?: CapabilityId;
    policyName?: string;
  };
  actual: {
    status: IntentResolution["status"];
    capabilityId?: CapabilityId;
    policyName?: string;
    confidence: number;
    resolver?: string;
  };
  failures: string[];
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const defaultDatasetPath = path.join(repoRoot, "evals/fidelity-uk-router-cases.jsonl");
const datasetPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultDatasetPath;

function readCases(filePath: string): RouterEvalCase[] {
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
      .map((line) => JSON.parse(line) as RouterEvalCase);
}

function extractLatestUserRequest(input: string) {
  const marker = "Latest user request:";
  const index = input.lastIndexOf(marker);
  if (index < 0) return input;
  const latest = input.slice(index + marker.length).trim();
  return latest || input;
}

function evaluateCase(testCase: RouterEvalCase, resolution: IntentResolution): CaseResult {
  const failures: string[] = [];
  if (resolution.status !== testCase.expectedStatus) {
    failures.push(`status expected ${testCase.expectedStatus}, got ${resolution.status}`);
  }

  if (testCase.expectedCapabilityId && resolution.capabilityId !== testCase.expectedCapabilityId) {
    failures.push(`capability expected ${testCase.expectedCapabilityId}, got ${resolution.capabilityId ?? "none"}`);
  }

  if (testCase.expectedPolicyName && resolution.policyDecision?.name !== testCase.expectedPolicyName) {
    failures.push(`policy expected ${testCase.expectedPolicyName}, got ${resolution.policyDecision?.name ?? "none"}`);
  }

  return {
    id: testCase.id,
    businessLine: testCase.businessLine,
    passed: failures.length === 0,
    expected: {
      status: testCase.expectedStatus,
      capabilityId: testCase.expectedCapabilityId,
      policyName: testCase.expectedPolicyName
    },
    actual: {
      status: resolution.status,
      capabilityId: resolution.capabilityId,
      policyName: resolution.policyDecision?.name,
      confidence: resolution.confidence,
      resolver: resolution.resolver
    },
    failures
  };
}

async function main() {
  const cases = readCases(datasetPath);
  const results = await Promise.all(
    cases.map(async (testCase) =>
      evaluateCase(testCase, await resolveIntent(extractLatestUserRequest(testCase.input), { useLlm: false }))
    )
  );
  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;
  const accuracy = results.length === 0 ? 0 : passed / results.length;

  console.log(
    JSON.stringify(
      {
        dataset: datasetPath,
        total: results.length,
        passed,
        failed,
        accuracy,
        results
      },
      null,
      2
    )
  );

  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
