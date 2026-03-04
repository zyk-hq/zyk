#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { createWorkflow, createWorkflowSchema } from "./tools/create-workflow.js";
import { runWorkflow, runWorkflowSchema } from "./tools/run-workflow.js";
import { getStatus, getStatusSchema } from "./tools/get-status.js";
import { listWorkflowsTool, listWorkflowsSchema } from "./tools/list-workflows.js";
import { listRuns, listRunsSchema } from "./tools/list-runs.js";
import { deleteWorkflowTool, deleteWorkflowSchema } from "./tools/delete-workflow.js";
import { updateWorkflowTool, updateWorkflowSchema } from "./tools/update-workflow.js";
import { listTemplatesTool, listTemplatesSchema } from "./tools/list-templates.js";
import { useTemplateTool, useTemplateSchema } from "./tools/use-template.js";
import { reviewWorkflowTool, reviewWorkflowSchema } from "./tools/review-workflow.js";
import { restoreWorkersOnStartup } from "./hatchet/register.js";
import { stopAllWorkers } from "./hatchet/worker.js";
import { startWebhookServer } from "./server/webhook.js";

// ── Server ────────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "zyk-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// Tool definitions
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "create_workflow",
      description:
        "Create and register a new durable workflow in Hatchet. " +
        "\n\nCLARIFICATION RULES — follow exactly:\n" +
        "Only ask if a business-level detail is genuinely ambiguous and has no reasonable default. " +
        "Ask all questions in ONE short message, then wait for answers. " +
        "NEVER ask about: which Slack channel (use process.env.SLACK_CHANNEL), which GitHub repo (use process.env.GITHUB_REPO), " +
        "who is on-call (use process.env.ONCALL_USER), which engineering/leadership/support channel (use process.env.ENGINEERING_CHANNEL / LEADERSHIP_CHANNEL / SUPPORT_CHANNEL), " +
        "Slack auth token (ALWAYS use process.env.SLACK_BOT_TOKEN — NEVER process.env.SLACK_TOKEN), " +
        "error handling (always throw on non-OK), retries (always 3), HTTP library (always fetch()), secrets (always process.env.VAR), " +
        "how to wait for Slack button clicks (always use the /slack/pending/:correlationId polling pattern — see below). " +
        "Once functional requirements are clear, generate code and call this tool immediately — no approval needed.\n" +
        "\n\nSLACK BUTTON INTERACTIONS — mandatory pattern (NEVER use waitForEvent or Hatchet events for Slack):\n" +
        "1. Post a Slack message with an actions block. Set block_id to a unique correlationId (e.g. `approval-${Date.now()}`).\n" +
        "2. Poll GET http://localhost:3100/slack/pending/<correlationId> every 3s.\n" +
        "3. Response is { pending: true } while waiting, or { pending: false, action: 'button_action_id', userId: '...' } once clicked.\n" +
        "Example poll loop (retries: 0 AND timeout: '4h' on polling tasks — REQUIRED to prevent Hatchet from killing the task):\n" +
        "```typescript\n" +
        "// task must have retries: 0, timeout: '4h'\n" +
        "const base = process.env.ZYK_WEBHOOK_BASE ?? 'http://localhost:3100';\n" +
        "const deadline = Date.now() + 60 * 60 * 1000;\n" +
        "while (Date.now() < deadline) {\n" +
        "  const r = await fetch(`${base}/slack/pending/${encodeURIComponent(correlationId)}`);\n" +
        "  const d = await r.json() as { pending: boolean; action?: string };\n" +
        "  if (!d.pending && d.action) return { action: d.action };\n" +
        "  await new Promise(r => setTimeout(r, 3000));\n" +
        "}\n" +
        "```\n" +
        "\n\nMANDATORY CODE TEMPLATE (copy this structure exactly — wrong patterns cause runtime errors):\n" +
        "```typescript\n" +
        'import { Hatchet } from "@hatchet-dev/typescript-sdk"; // named import — NOT default\n' +
        "const hatchet = Hatchet.init();\n" +
        'const workflow = hatchet.workflow({ name: "my-workflow" });\n' +
        "// Store return value of each task — needed for parent refs\n" +
        "const step1 = workflow.task({\n" +
        '  name: "step-1",\n' +
        "  retries: 3,\n" +
        "  fn: async (_input, ctx) => {  // key is 'fn', NOT 'run'; ctx is SECOND param\n" +
        '    await ctx.log("step 1");\n' +
        "    return { value: 42 };\n" +
        "  },\n" +
        "});\n" +
        "workflow.task({\n" +
        '  name: "step-2",\n' +
        "  parents: [step1],             // pass task REF, NOT a string\n" +
        "  fn: async (_input, ctx) => {\n" +
        "    const { value } = await ctx.parentOutput(step1); // must await\n" +
        "    return { done: true };\n" +
        "  },\n" +
        "});\n" +
        'const worker = await hatchet.worker("my-workflow-worker", { workflows: [workflow] });\n' +
        "export default { start: () => worker.start() };\n" +
        "```\n" +
        "RULES: (1) import { Hatchet } named, never default. " +
        "(2) fn: not run:. " +
        "(3) fn signature (input, ctx) — ctx is second. " +
        "(4) parents: [taskRef] not parents: ['string']. " +
        "(5) await ctx.parentOutput(taskRef). " +
        "(6) await hatchet.worker(...). " +
        "(7) Use process.env.VAR for secrets. " +
        "(8) Use fetch() for HTTP — no extra packages. " +
        "\n\nDIAGRAM: The diagram is stored internally and rendered automatically in the Zyk browser dashboard (localhost:3100). " +
        "Do NOT output any mermaid diagram in your reply — just confirm the workflow was created.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Human-readable workflow name" },
          description: { type: "string", description: "What this workflow does" },
          code: { type: "string", description: "TypeScript Hatchet workflow code" },
          schedule: {
            type: "string",
            description: "Cron expression for scheduled workflows (e.g. '0 8 * * *')",
          },
          trigger: {
            type: "string",
            enum: ["on-demand", "schedule"],
            description: "How the workflow is triggered",
            default: "on-demand",
          },
          diagram: {
            type: "string",
            description:
              "Mermaid flowchart diagram. Use flowchart TD, plain node labels, no %%{init}%% block. " +
              "Do NOT output this diagram in your reply — it is rendered automatically in the Zyk dashboard.",
          },
        },
        required: ["name", "description", "code"],
      },
    },
    {
      name: "update_workflow",
      description:
        "Update an existing workflow's code, description, trigger, or schedule. " +
        "The worker is restarted automatically. The workflow ID is preserved. " +
        "Ask clarifying questions about functional changes if needed (same rules as create_workflow), " +
        "but never ask about technical choices. " +
        "Use the same mandatory code pattern as create_workflow: import { Hatchet } named, fn: not run:, parents: [taskRef] not strings.",
      inputSchema: {
        type: "object",
        properties: {
          workflow_id: { type: "string", description: "The workflow ID to update" },
          code: { type: "string", description: "New TypeScript workflow code (replaces existing)" },
          description: { type: "string", description: "Updated description" },
          trigger: {
            type: "string",
            enum: ["on-demand", "schedule"],
            description: "Updated trigger type",
          },
          schedule: { type: "string", description: "Updated cron expression" },
          diagram: { type: "string", description: "Updated Mermaid diagram" },
        },
        required: ["workflow_id"],
      },
    },
    {
      name: "run_workflow",
      description:
        "Trigger an execution of a registered workflow. Returns a run_id you can use with get_status.",
      inputSchema: {
        type: "object",
        properties: {
          workflow_id: {
            type: "string",
            description: "The workflow ID returned by create_workflow",
          },
          params: {
            type: "object",
            description: "Runtime parameters to pass to the workflow",
            additionalProperties: true,
          },
        },
        required: ["workflow_id"],
      },
    },
    {
      name: "get_status",
      description:
        "Get the current status of a workflow or a specific workflow run.",
      inputSchema: {
        type: "object",
        properties: {
          workflow_id: { type: "string", description: "The workflow ID" },
          run_id: {
            type: "string",
            description: "Optional specific run ID to get status for",
          },
        },
        required: ["workflow_id"],
      },
    },
    {
      name: "list_workflows",
      description: "List all registered workflows and their current worker status (running/stopped). Use list_runs to see actual executions.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "list_runs",
      description:
        "List recent workflow run executions from Hatchet. " +
        "Use this when the user asks about runs, executions, history, or what happened. " +
        "Optionally filter by workflow_id, status, or time window.",
      inputSchema: {
        type: "object",
        properties: {
          workflow_id: {
            type: "string",
            description: "Filter by a specific workflow ID (optional — omit for all workflows)",
          },
          limit: {
            type: "number",
            description: "Max runs to return (default 20, max 100)",
          },
          status: {
            type: "string",
            enum: ["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"],
            description: "Filter by run status (optional)",
          },
          since_hours: {
            type: "number",
            description: "How many hours back to look (default 24)",
          },
        },
      },
    },
    {
      name: "delete_workflow",
      description: "Remove a workflow from the registry and stop its worker process.",
      inputSchema: {
        type: "object",
        properties: {
          workflow_id: { type: "string", description: "The workflow ID to delete" },
        },
        required: ["workflow_id"],
      },
    },
    {
      name: "list_templates",
      description:
        "List pre-built workflow templates from the Zyk library. Requires ZYK_API_KEY.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "use_template",
      description:
        "Fetch the full code for a workflow template so you can deploy it with create_workflow. Requires ZYK_API_KEY.",
      inputSchema: {
        type: "object",
        properties: {
          template_id: {
            type: "string",
            description: "The template ID from list_templates",
          },
        },
        required: ["template_id"],
      },
    },
    {
      name: "review_workflow",
      description:
        "Send a workflow's code to Zyk's AI backend for quality suggestions. Requires ZYK_API_KEY.",
      inputSchema: {
        type: "object",
        properties: {
          workflow_id: {
            type: "string",
            description: "The workflow ID to review",
          },
        },
        required: ["workflow_id"],
      },
    },
  ],
}));

// Tool call handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: unknown;

    switch (name) {
      case "create_workflow": {
        const input = createWorkflowSchema.parse(args);
        result = await createWorkflow(input);
        break;
      }
      case "update_workflow": {
        const input = updateWorkflowSchema.parse(args);
        result = await updateWorkflowTool(input);
        break;
      }
      case "run_workflow": {
        const input = runWorkflowSchema.parse(args);
        result = await runWorkflow(input);
        break;
      }
      case "get_status": {
        const input = getStatusSchema.parse(args);
        result = await getStatus(input);
        break;
      }
      case "list_workflows": {
        const input = listWorkflowsSchema.parse(args);
        result = await listWorkflowsTool(input);
        break;
      }
      case "list_runs": {
        const input = listRunsSchema.parse(args);
        result = await listRuns(input);
        break;
      }
      case "delete_workflow": {
        const input = deleteWorkflowSchema.parse(args);
        result = await deleteWorkflowTool(input);
        break;
      }
      case "list_templates": {
        const input = listTemplatesSchema.parse(args);
        result = await listTemplatesTool(input);
        break;
      }
      case "use_template": {
        const input = useTemplateSchema.parse(args);
        result = await useTemplateTool(input);
        break;
      }
      case "review_workflow": {
        const input = reviewWorkflowSchema.parse(args);
        result = await reviewWorkflowTool(input);
        break;
      }
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// Startup
async function main() {
  // Start the webhook HTTP receiver (also serves dashboard at /)
  const webhookPort = parseInt(process.env.WEBHOOK_PORT ?? "3100", 10);
  startWebhookServer(webhookPort);

  // Connect MCP transport first — never block Claude waiting for workers
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Zyk MCP server running on stdio");

  // Restore workers in the background after the server is ready
  restoreWorkersOnStartup().catch((err) => {
    console.error("Warning: Could not restore workers:", err);
  });
}

// Graceful shutdown
process.on("SIGINT", async () => {
  await stopAllWorkers();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await stopAllWorkers();
  process.exit(0);
});

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
