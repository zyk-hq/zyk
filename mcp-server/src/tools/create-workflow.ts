import { z } from "zod";
import { randomUUID } from "crypto";
import { registerWorkflow } from "../hatchet/register.js";
import { validateWorkflowCode } from "../utils/code-runner.js";
import { track } from "../lib/zyk-api.js";

export const createWorkflowSchema = z.object({
  name: z.string().describe("Human-readable workflow name"),
  description: z.string().describe("What this workflow does"),
  code: z.string().describe("TypeScript Hatchet workflow code"),
  schedule: z
    .string()
    .optional()
    .describe("Cron expression for scheduled workflows (e.g. '0 8 * * *')"),
  trigger: z
    .enum(["on-demand", "schedule"])
    .default("on-demand")
    .describe("How the workflow is triggered"),
  diagram: z
    .string()
    .optional()
    .describe("Mermaid flowchart diagram representing the workflow"),
});

export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;

export async function createWorkflow(input: CreateWorkflowInput) {
  const { name, description, code, schedule, trigger, diagram } = input;

  // Validate the code before registering
  const validation = validateWorkflowCode(code);

  if (!validation.valid) {
    return {
      success: false,
      error: `Invalid workflow code:\n${validation.errors.join("\n")}`,
      warnings: validation.warnings,
    };
  }

  const id = `wf-${randomUUID().slice(0, 8)}`;

  try {
    const entry = await registerWorkflow({
      id,
      name,
      description,
      code,
      trigger,
      schedule,
      diagram,
    });

    const result: Record<string, unknown> = {
      success: true,
      workflow_id: entry.id,
      name: entry.name,
      description: entry.description,
      trigger: entry.trigger,
      schedule: entry.schedule,
      created_at: entry.createdAt,
      message: `Workflow "${name}" registered and worker started successfully.`,
    };

    if (validation.warnings.length > 0) {
      result.warnings = validation.warnings;
    }

    track("workflow_created", { trigger });

    return result;
  } catch (err) {
    return {
      success: false,
      error: `Failed to register workflow: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
