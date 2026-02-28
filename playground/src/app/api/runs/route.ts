/**
 * GET /api/runs?sessionId=...&limit=50&status=COMPLETED
 * Proxies Hatchet REST API for run history.
 */

import { NextRequest, NextResponse } from "next/server";
import { getHatchetClient } from "@/lib/hatchet-client";
import { listWorkflowsBySession } from "@/lib/registry";
import { hatchetWorkflowName } from "@/lib/code-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const sessionId = searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 100);
  const status = searchParams.get("status") ?? undefined;
  const sinceHours = parseInt(searchParams.get("since_hours") ?? "24", 10);
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();

  // Build a name→id map for this session's workflows
  const nameMap: Record<string, string> = {};
  for (const wf of listWorkflowsBySession(sessionId)) {
    nameMap[hatchetWorkflowName(wf.name, wf.sessionId)] = wf.id;
  }

  try {
    const hatchet = getHatchetClient();
    const tenantId = hatchet.tenantId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await (hatchet.api as any).v1WorkflowRunList(tenantId, {
      since,
      limit,
      only_tasks: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(status ? { statuses: [status as any] } : {}),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = (resp.data as any)?.rows ?? [];
    const runs = rows.map((r) => {
      const workflowName: string =
        r.displayName?.split("/")?.[0] ?? r.workflowName ?? "unknown";
      return {
        run_id: r.metadata?.id ?? r.id,
        workflow_name: workflowName,
        workflow_id: nameMap[workflowName] ?? null,
        status: r.status,
        started_at: r.metadata?.createdAt ?? r.createdAt,
        finished_at: r.finishedAt ?? null,
        duration_ms: r.duration ?? null,
      };
    });
    return NextResponse.json({ runs, since });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to fetch runs: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 }
    );
  }
}
