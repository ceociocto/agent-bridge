import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod/v4";
import {
  capabilityIds,
  demoScenarios,
  getDemoScenario,
  type CapabilityId
} from "@agent-bridge/shared";
import { appResourceUri, renderAppWidgetHtml } from "./appWidget.js";
import { gatewayClient, getGatewayBaseUrl } from "./gatewayClient.js";

const capabilityIdSchema = z.enum([...capabilityIds] as [CapabilityId, ...CapabilityId[]]);
const demoScenarioIdSchema = z.enum(
  demoScenarios.map((scenario) => scenario.id) as [string, ...string[]]
);
const appToolTemplateMeta = {
  _meta: {
    ui: {
      resourceUri: appResourceUri,
      visibility: ["model", "app"]
    },
    "openai/outputTemplate": appResourceUri,
    "openai/widgetAccessible": true
  }
};

function jsonText(value: unknown) {
  return {
    structuredContent: value,
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

  server.registerResource(
    "demo-scenarios",
    "agent-bridge://demo/scenarios",
    {
      title: "Demo Scenarios",
      description:
        "Curated Agent-Bridge MCP app scenarios covering routing, governance, charts, and confirmation gates.",
      mimeType: "application/json"
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ scenarios: demoScenarios }, null, 2)
        }
      ]
    })
  );

  server.registerResource(
    "agent-bridge-app",
    appResourceUri,
    {
      title: "Agent-Bridge MCP App",
      description: "Interactive MCP app for governed financial agent scenarios.",
      mimeType: "text/html"
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/html",
          text: renderAppWidgetHtml(),
          _meta: {
            ui: {
              prefersBorder: true,
              csp: {
                connectDomains: [],
                resourceDomains: []
              }
            },
            "openai/widgetDescription":
              "A compact Agent-Bridge card widget that renders the core scenario component only."
          }
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
    "open_agent_bridge_app",
    {
      title: "Open Agent-Bridge App",
      description:
        "Open the interactive Agent-Bridge MCP app with scenario demos for governed financial agent interactions.",
      inputSchema: z.object({
        scenarioId: demoScenarioIdSchema.optional().describe("Optional scenario to preselect.")
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false
      },
      ...appToolTemplateMeta,
      _meta: {
        ...appToolTemplateMeta._meta,
        "openai/toolInvocation/invoking": "Opening Agent-Bridge",
        "openai/toolInvocation/invoked": "Agent-Bridge ready"
      }
    },
    async ({ scenarioId }) => {
      const activeScenario = scenarioId ? getDemoScenario(scenarioId) : demoScenarios[0];
      return jsonText({
        app: {
          name: "Agent-Bridge",
          resourceUri: appResourceUri
        },
        activeScenarioId: activeScenario?.id ?? demoScenarios[0].id,
        scenarios: demoScenarios
      });
    }
  );

  server.registerTool(
    "list_demo_scenarios",
    {
      title: "List Agent-Bridge Demo Scenarios",
      description:
        "List curated demo scenarios that exercise MCP tools, app UI components, routing, policy, and audit behavior.",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false
      },
      ...appToolTemplateMeta,
      _meta: {
        ...appToolTemplateMeta._meta,
        ui: { visibility: ["model", "app"] },
        "openai/widgetAccessible": true,
        "openai/toolInvocation/invoking": "Loading scenarios",
        "openai/toolInvocation/invoked": "Scenarios loaded"
      }
    },
    async () => jsonText({ scenarios: demoScenarios })
  );

  server.registerTool(
    "run_demo_scenario",
    {
      title: "Run Agent-Bridge Demo Scenario",
      description:
        "Execute a curated Agent-Bridge scenario through the gateway and return structured data for app components.",
      inputSchema: z.object({
        scenarioId: demoScenarioIdSchema.describe("Curated demo scenario id.")
      }),
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        idempotentHint: true
      },
      ...appToolTemplateMeta,
      _meta: {
        ...appToolTemplateMeta._meta,
        "openai/toolInvocation/invoking": "Running scenario",
        "openai/toolInvocation/invoked": "Scenario complete"
      }
    },
    async ({ scenarioId }) => {
      try {
        const scenario = getDemoScenario(scenarioId);
        if (!scenario) throw new Error(`Unknown demo scenario: ${scenarioId}`);

        if (scenario.executionMode === "static") {
          return jsonText({
            scenario,
            response: {
              resolution: {
                status: scenario.expectedStatus,
                intent: scenario.title,
                confidence: 1,
                reasoning: scenario.narrative,
                resolver: "rules"
              },
              result: {
                summary: scenario.narrative,
                chart: scenario.chart
              }
            },
            audit: null,
            app: {
              components: scenario.components,
              interactionPattern: scenario.interactionPattern,
              expectedSignals: scenario.expectedSignals,
              compact: true
            }
          });
        }

        const response = await gatewayClient.agentRequest({
          prompt: scenario.prompt,
          ...scenario.input
        });
        const audit = response.result?.audit_trace_id
          ? await gatewayClient.audit(response.result.audit_trace_id).catch(() => null)
          : null;

        return jsonText({
          scenario,
          response,
          audit,
          app: {
            components: scenario.components,
            interactionPattern: scenario.interactionPattern,
            expectedSignals: scenario.expectedSignals
          }
        });
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
