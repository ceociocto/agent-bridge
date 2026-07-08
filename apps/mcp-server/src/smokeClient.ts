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
    name: "agent-bridge-smoke-client",
    version: "0.1.0"
  });

  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/server.js"],
    cwd: packageDir,
    env: envForTransport(),
    stderr: "pipe"
  });

  const stderrChunks: string[] = [];
  transport.stderr?.on("data", (chunk) => stderrChunks.push(String(chunk)));

  await client.connect(transport);

  const tools = await client.listTools();
  const requiredTools = ["list_capabilities", "resolve_intent", "invoke_capability", "agent_request"];
  for (const toolName of requiredTools) {
    if (!tools.tools.some((tool) => tool.name === toolName)) {
      throw new Error(`Missing MCP tool: ${toolName}`);
    }
  }

  const resources = await client.listResources();
  const requiredResources = ["agent-bridge://gateway/health", "agent-bridge://capabilities"];
  for (const uri of requiredResources) {
    if (!resources.resources.some((resource) => resource.uri === uri)) {
      throw new Error(`Missing MCP resource: ${uri}`);
    }
  }

  await client.readResource({ uri: "agent-bridge://capabilities" });

  const listResult = await client.callTool({
    name: "list_capabilities",
    arguments: {}
  });
  if (listResult.isError) throw new Error(`list_capabilities failed: ${JSON.stringify(listResult)}`);

  const invokeResult = await client.callTool({
    name: "invoke_capability",
    arguments: {
      capabilityId: "retirement_readiness_assessment",
      customerId: "C001",
      targetRetirementAge: 62
    }
  });
  if (invokeResult.isError) throw new Error(`invoke_capability failed: ${JSON.stringify(invokeResult)}`);

  const agentResult = await client.callTool({
    name: "agent_request",
    arguments: {
      prompt: "Can this client retire at age 62?",
      customerId: "C001",
      targetRetirementAge: 62
    }
  });
  if (agentResult.isError) throw new Error(`agent_request failed: ${JSON.stringify(agentResult)}`);

  await client.close();

  console.log(
    JSON.stringify(
      {
        status: "ok",
        tools: tools.tools.map((tool) => tool.name),
        resources: resources.resources.map((resource) => resource.uri),
        serverStderr: stderrChunks.join("").trim()
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
