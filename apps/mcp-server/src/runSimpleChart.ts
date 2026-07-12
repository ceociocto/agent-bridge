import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function envForTransport(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.CAPABILITY_GATEWAY_URL = env.CAPABILITY_GATEWAY_URL ?? "http://localhost:4100";
  return env;
}

async function main() {
  const client = new Client({
    name: "agent-bridge-simple-chart-runner",
    version: "0.1.0"
  });

  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/server.js"],
    cwd: packageDir,
    env: envForTransport(),
    stderr: "pipe"
  });

  transport.stderr?.on("data", (chunk) => process.stderr.write(String(chunk)));

  await client.connect(transport);

  const result = await client.callTool({
    name: "run_demo_scenario",
    arguments: {
      scenarioId: "simple-chart"
    }
  });

  await client.close();

  if (result.isError) {
    console.error("Scenario returned an error:");
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(result.content, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
