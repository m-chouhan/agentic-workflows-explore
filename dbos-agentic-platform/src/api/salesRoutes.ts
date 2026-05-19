import { Router, Request, Response } from "express";
import { DBOSClient } from "@dbos-inc/dbos-sdk";
import { z } from "zod";
import { queryOne } from "../db/postgres";
import { ANALYSIS_QUEUE_NAME, ANALYZE_YEAR_WORKFLOW } from "../config";

const AnalyzeRequestSchema = z.object({
  year: z.number().int().min(2000).max(2100),
});

export function buildSalesRouter(client: DBOSClient): Router {
  const router = Router();

  router.post("/analyze", async (req: Request, res: Response) => {
    const parsed = AnalyzeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", details: parsed.error.format() });
      return;
    }

    const { year } = parsed.data;
    const workflowId = `analyze-${year}-${Date.now()}`;

    try {
      await client.enqueue(
        { queueName: ANALYSIS_QUEUE_NAME, workflowName: ANALYZE_YEAR_WORKFLOW, workflowID: workflowId },
        year,
      );
      res.status(202).json({ workflowId, status: "ENQUEUED", pollUrl: `/workflow/analyze/${workflowId}` });
    } catch (err) {
      res.status(500).json({ error: "enqueue_failed", message: (err as Error).message });
    }
  });

  router.get("/analyze/:id", async (req: Request, res: Response) => {
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

  router.get("/insights/:year", async (req: Request, res: Response) => {
    const year = parseInt(req.params.year, 10);
    if (isNaN(year)) { res.status(400).json({ error: "invalid_year" }); return; }

    const row = await queryOne<Record<string, unknown>>(
      `SELECT id, workflow_id, year, generated_at, total_revenue, total_units,
              top_product, top_region, summary, insights_json
       FROM sales_insights WHERE year = $1 ORDER BY generated_at DESC LIMIT 1`,
      [year],
    );
    if (!row) { res.status(404).json({ error: "no_insights_for_year", year }); return; }
    res.json({ ...row, insights_json: JSON.parse(row.insights_json as string) });
  });

  return router;
}
