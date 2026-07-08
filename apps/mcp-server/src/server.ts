import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod/v4";
import { capabilityIds, type CapabilityId } from "@agent-bridge/shared";
import { gatewayClient, getGatewayBaseUrl } from "./gatewayClient.js";

const capabilityIdSchema = z.enum([...capabilityIds] as [CapabilityId, ...CapabilityId[]]);

function jsonText(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function toolError(error: unknown) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: error instanceof Error ? error.message : String(error)
      }
    ]
  };
}

export function createServer() {
  const server = new McpServer(
    {
      name: "agent-bridge-mcp-server",
      version: "0.1.0"
    },
    {
      capabilities: {
        resources: {},
        tools: {}
      }
    }
  );

  server.registerResource(
    "gateway-health",
    "agent-bridge://gateway/health",
    {
      title: "Gateway Health",
      description: "Live health information from the Agent-Bridge capability gateway.",
      mimeType: "application/json"
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(await gatewayClient.health(), null, 2)
        }
      ]
    })
  );

  server.registerResource(
    "capability-catalog",
    "agent-bridge://capabilities",
    {
      title: "Capability Catalog",
      description: "The governed business capabilities currently published by Agent-Bridge.",
      mimeType: "application/json"
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(await gatewayClient.capabilities(), null, 2)
        }
      ]
    })
  );

  server.registerTool(
    "list_capabilities",
    {
      title: "List Agent-Bridge Capabilities",
      description: "Discover governed business capabilities exposed by the capability gateway.",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false
      }
    },
    async () => {
      try {
        return jsonText(await gatewayClient.capabilities());
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "resolve_intent",
    {
      title: "Resolve Financial Intent",
      description: "Resolve a natural-language user request to a published Agent-Bridge capability.",
      inputSchema: z.object({
        prompt: z.string().min(1).describe("The user request to classify.")
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false
      }
    },
    async ({ prompt }) => {
      try {
        return jsonText(await gatewayClient.resolveIntent(prompt));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "invoke_capability",
    {
      title: "Invoke Governed Capability",
      description:
        "Invoke a specific governed capability after the caller has selected it and supplied scoped customer input.",
      inputSchema: z.object({
        capabilityId: capabilityIdSchema.describe("Published Agent-Bridge capability id."),
        customerId: z.string().min(1).describe("Customer id in the active request context."),
        targetRetirementAge: z.number().int().min(50).max(75).optional(),
        desiredContributionRate: z.number().min(0).max(100).optional(),
        plannedIsaSubscription: z.number().min(0).max(100000).optional(),
        plannedDrawdownIncome: z.number().min(0).max(250000).optional(),
        drawdownGoal: z
          .enum(["keep_invested", "take_income_within_five_years", "cash_out", "buy_annuity"])
          .optional(),
        adviserFirmId: z.string().min(1).optional(),
        riskProfile: z.enum(["cautious", "balanced", "growth", "adventurous"]).optional()
      }),
      annotations: {
        readOnlyHint: false,
        openWorldHint: false
      }
    },
    async ({
      capabilityId,
      customerId,
      targetRetirementAge,
      desiredContributionRate,
      plannedIsaSubscription,
      plannedDrawdownIncome,
      drawdownGoal,
      adviserFirmId,
      riskProfile
    }) => {
      try {
        return jsonText(
          await gatewayClient.invokeCapability(capabilityId, {
            customerId,
            targetRetirementAge,
            desiredContributionRate,
            plannedIsaSubscription,
            plannedDrawdownIncome,
            drawdownGoal,
            adviserFirmId,
            riskProfile
          })
        );
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "agent_request",
    {
      title: "Handle Agent Request",
      description:
        "Run the full Agent-Bridge flow: intent resolution, policy checks, capability composition, and audit-friendly response.",
      inputSchema: z.object({
        prompt: z.string().min(1).describe("The user's natural-language request."),
        customerId: z.string().min(1).describe("Customer id in the active request context."),
        targetRetirementAge: z.number().int().min(50).max(75).optional(),
        desiredContributionRate: z.number().min(0).max(100).optional(),
        plannedIsaSubscription: z.number().min(0).max(100000).optional(),
        plannedDrawdownIncome: z.number().min(0).max(250000).optional(),
        drawdownGoal: z
          .enum(["keep_invested", "take_income_within_five_years", "cash_out", "buy_annuity"])
          .optional(),
        adviserFirmId: z.string().min(1).optional(),
        riskProfile: z.enum(["cautious", "balanced", "growth", "adventurous"]).optional()
      }),
      annotations: {
        readOnlyHint: false,
        openWorldHint: false
      }
    },
    async ({
      prompt,
      customerId,
      targetRetirementAge,
      desiredContributionRate,
      plannedIsaSubscription,
      plannedDrawdownIncome,
      drawdownGoal,
      adviserFirmId,
      riskProfile
    }) => {
      try {
        return jsonText(
          await gatewayClient.agentRequest({
            prompt,
            customerId,
            targetRetirementAge,
            desiredContributionRate,
            plannedIsaSubscription,
            plannedDrawdownIncome,
            drawdownGoal,
            adviserFirmId,
            riskProfile
          })
        );
      } catch (error) {
        return toolError(error);
      }
    }
  );

  return server;
}

async function main() {
  await serveStdio(createServer);
  console.error(`Agent-Bridge MCP server connected over stdio; gateway=${getGatewayBaseUrl()}`);
}

main().catch((error) => {
  console.error("Agent-Bridge MCP server failed to start", error);
  process.exit(1);
});
