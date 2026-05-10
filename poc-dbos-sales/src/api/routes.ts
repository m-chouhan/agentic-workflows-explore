// Routes — enqueue/poll workflows via DBOSClient; no workflow code imported.
// POST /api/analyze  { year } → enqueue analyzeYear → workflowId
// GET  /api/analyze/:id       → poll status / result
// GET  /api/insights/:year    → latest stored insight from SQLite
// GET  /healthz               → liveness
import { Router, Request, Response } from "express";
import { DBOSClient } from "@dbos-inc/dbos-sdk";
import { z } from "zod";
import { bootstrapAndGetDb } from "../db/sqlite"; 

const ANALYSIS_QUEUE_NAME  = process.env.ANALYSIS_QUEUE_NAME ?? "analysis-queue";
const ANALYZE_YEAR_WORKFLOW = "analyzeYear"; // must match name in DBOS.registerWorkflow({ name: "analyzeYear" })

const AnalyzeRequestSchema = z.object({
  year: z.number().int().min(2000).max(2100),
});

export function buildRouter(client: DBOSClient): Router {
  const router = Router();

  router.get("/healthz", (_req: Request, res: Response) => {
    res.json({ ok: true, ts: new Date().toISOString() });
  });

  router.post("/api/analyze", async (req: Request, res: Response) => {
    const parsed = AnalyzeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", details: parsed.error.format() });
      return;
    }

    const { year } = parsed.data;
    const workflowId = `analyze-${year}-${Date.now()}`;

    try {
      console.log(`[server] → ENQUEUE  year=${year}  workflowId=${workflowId}`);
      await client.enqueue(
        { queueName: ANALYSIS_QUEUE_NAME, workflowName: ANALYZE_YEAR_WORKFLOW, workflowID: workflowId },
        year,
      );
      console.log(`[server] ✓ enqueued  workflowId=${workflowId}`);
      res.status(202).json({ workflowId, status: "ENQUEUED", pollUrl: `/api/analyze/${workflowId}` });
    } catch (err) {
      console.error(`[server] ✗ enqueue failed:`, (err as Error).message);
      res.status(500).json({ error: "enqueue_failed", message: (err as Error).message });
    }
  });

  router.get("/api/analyze/:id", async (req: Request, res: Response) => {
    const { id } = req.params;
    console.log(`[server] → POLL  workflowId=${id}`);
    try {
      const wf = await client.getWorkflow(id);
      if (!wf) {
        res.status(404).json({ error: "not_found", workflowId: id });
        return;
      }
      console.log(`[server] ✓ status=${wf.status}  workflowId=${id}`);
      if (wf.status === "SUCCESS") { res.json({ workflowId: id, status: wf.status, result: wf.output }); return; }
      if (wf.status === "ERROR")   { res.status(500).json({ workflowId: id, status: wf.status, error: wf.error }); return; }
      res.json({ workflowId: id, status: wf.status });
    } catch (err) {
      console.error(`[server] ✗ poll failed:`, (err as Error).message);
      res.status(500).json({ error: "lookup_failed", message: (err as Error).message });
    }
  });

  router.get("/api/insights/:year", (req: Request, res: Response) => {
    const year = Number.parseInt(req.params.year, 10);
    if (Number.isNaN(year)) { res.status(400).json({ error: "invalid_year" }); return; }

    const row = bootstrapAndGetDb()
      .prepare(
        `SELECT id, workflow_id, year, generated_at, total_revenue, total_units,
                top_product, top_region, summary, insights_json
         FROM sales_insights WHERE year = ? ORDER BY generated_at DESC LIMIT 1`,
      )
      .get(year) as Record<string, unknown> | undefined;

    if (!row) { res.status(404).json({ error: "no_insights_for_year", year }); return; }

    res.json({ ...row, insights_json: JSON.parse(row.insights_json as string) });
  });

  return router;
}
