import { Router, Request, Response } from "express";
import { DBOSClient } from "@dbos-inc/dbos-sdk";
import { z } from "zod";
import { queryOne } from "../db/postgres";
import { VULN_QUEUE_NAME, SCAN_AND_FIX_WORKFLOW } from "../config";

const ScanRequestSchema = z.object({
  repo: z.string().min(1).describe("GitHub repo in owner/name format"),
  branch: z.string().default("main"),
});

export function buildVulnRouter(client: DBOSClient): Router {
  const router = Router();

  router.post("/api/scan", async (req: Request, res: Response) => {
    const parsed = ScanRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", details: parsed.error.format() });
      return;
    }

    const { repo, branch } = parsed.data;
    const workflowId = `scan-${repo.replace("/", "-")}-${Date.now()}`;

    try {
      await client.enqueue(
        { queueName: VULN_QUEUE_NAME, workflowName: SCAN_AND_FIX_WORKFLOW, workflowID: workflowId },
        repo, branch,
      );
      res.status(202).json({ workflowId, status: "ENQUEUED", pollUrl: `/api/scan/${workflowId}` });
    } catch (err) {
      res.status(500).json({ error: "enqueue_failed", message: (err as Error).message });
    }
  });

  router.get("/api/scan/:id", async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      const wf = await client.getWorkflow(id);
      if (!wf) { res.status(404).json({ error: "not_found", workflowId: id }); return; }
      if (wf.status === "SUCCESS") { res.json({ workflowId: id, status: wf.status, result: wf.output }); return; }
      if (wf.status === "ERROR")   { res.status(500).json({ workflowId: id, status: wf.status, error: wf.error }); return; }
      res.json({ workflowId: id, status: wf.status });
    } catch (err) {
      res.status(500).json({ error: "lookup_failed", message: (err as Error).message });
    }
  });

  router.get("/api/findings/:repo", async (req: Request, res: Response) => {
    const repo = req.params.repo;
    if (!repo) { res.status(400).json({ error: "missing_repo" }); return; }

    const repoName = repo.replace("--", "/");

    const row = await queryOne<Record<string, unknown>>(
      `SELECT id, workflow_id, repo, branch, scanned_at, total_findings,
              blocker_count, triage_json, findings_json
       FROM scan_results WHERE repo = $1 ORDER BY scanned_at DESC LIMIT 1`,
      [repoName],
    );
    if (!row) { res.status(404).json({ error: "no_findings_for_repo", repo: repoName }); return; }
    res.json({
      ...row,
      findings_json: JSON.parse(row.findings_json as string),
      triage_json: row.triage_json ? JSON.parse(row.triage_json as string) : null,
    });
  });

  return router;
}
