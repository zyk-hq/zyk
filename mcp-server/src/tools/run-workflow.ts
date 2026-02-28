import { z } from "zod";
import { getWorkflow } from "../hatchet/register.js";
import { getHatchetClient } from "../hatchet/client.js";
import { track, recordRun } from "../lib/zyk-api.js";

export const runWorkflowSchema = z.object({
  workflow_id: z.string().describe("The workflow ID returned by create_workflow"),
  params: z
    .record(z.unknown())
    .optional()
    .describe("Runtime parameters to pass to the workflow"),
});

export type RunWorkflowInput = z.infer<typeof runWorkflowSchema>;

export async function runWorkflow(input: RunWorkflowInput) {
  const { workflow_id, params = {} } = input;

  const entry = getWorkflow(workflow_id);
  if (!entry) {
    return {
      success: false,
      error: `Workflow "${workflow_id}" not found. Use list_workflows to see available workflows.`,
    };
  }

  try {
    const hatchet = getHatchetClient();

    // Trigger the workflow by name without waiting for it to complete.
    // Hatchet normalizes workflow names to lowercase internally, so we must match.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runRef = await hatchet.runNoWait(entry.name.toLowerCase().replace(/\s+/g, "-"), params as any, {});

    const runId = await runRef.workflowRunId;

    const runIdStr = typeof runId === "string" ? runId : runId.workflowRunId;
    track("workflow_run", { trigger: entry.trigger });
    recordRun(entry.id, runIdStr, entry.trigger);

    return {
      success: true,
      workflow_id: entry.id,
      workflow_name: entry.name,
      run_id: runId,
      message: `Workflow "${entry.name}" triggered successfully.`,
      hint: `Use get_status with workflow_id="${workflow_id}" to check progress.`,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to run workflow: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
