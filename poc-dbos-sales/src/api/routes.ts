/**
 * Express routes for triggering and inspecting sales-analysis workflows.
 *
 *   POST /api/analyze            { "year": 2025 }   → returns { workflowId, status: "PENDING" }
 *   GET  /api/analyze/:id                            → returns { workflowId, status, result? }
 *   GET  /api/insights/:year                         → returns latest stored insight for a year
 *   GET  /healthz                                    → liveness
 */
import { Router, Request, Response } from "express";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { z } from "zod";
import { getDb } from "../db/sqlite";
import { SalesAnalysisWorkflow } from "../workflows/analyzeSales";

const AnalyzeRequestSchema = z.object({
  year: z.number().int().min(2000).max(2100),
});

export function buildRouter(): Router {
  const router = Router();

  router.get("/healthz", (_req: Request, res: Response) => {
    res.json({ ok: true, ts: new Date().toISOString() });
  });

  // Trigger a new workflow. Returns immediately with a workflow ID.
  router.post("/api/analyze", async (req: Request, res: Response) => {
    const parsed = AnalyzeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", details: parsed.error.format() });
      return;
    }
    const { year } = parsed.data;
    const workflowId = `analyze-${year}-${Date.now()}`;

    // Start the workflow asynchronously; do not await its completion.
    const handle = await DBOS.startWorkflow(SalesAnalysisWorkflow, { workflowID: workflowId })
      .analyzeYear(year);

    res.status(202).json({
      workflowId: handle.workflowID,
      status: "PENDING",
      pollUrl: `/api/analyze/${handle.workflowID}`,
    });
  });

  // Poll workflow status / result.
  router.get("/api/analyze/:id", async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      const handle = DBOS.retrieveWorkflow(id);
      const status = await handle.getStatus();
      if (!status) {
        res.status(404).json({ error: "not_found", workflowId: id });
        return;
      }

      if (status.status === "SUCCESS") {
        const result = await handle.getResult();
        res.json({ workflowId: id, status: status.status, result });
        return;
      }

      res.json({ workflowId: id, status: status.status });
    } catch (err) {
      res.status(500).json({ error: "lookup_failed", message: (err as Error).message });
    }
  });

  // Convenience: read the latest stored insight for a year directly from SQLite.
  router.get("/api/insights/:year", (req: Request, res: Response) => {
    const year = Number.parseInt(req.params.year, 10);
    if (Number.isNaN(year)) {
      res.status(400).json({ error: "invalid_year" });
      return;
    }
    const row = getDb()
      .prepare(
        `SELECT id, workflow_id, year, generated_at, total_revenue, total_units,
                top_product, top_region, summary, insights_json
         FROM sales_insights
         WHERE year = ?
         ORDER BY generated_at DESC
         LIMIT 1`,
      )
      .get(year) as Record<string, unknown> | undefined;

    if (!row) {
      res.status(404).json({ error: "no_insights_for_year", year });
      return;
    }
    res.json({
      ...row,
      insights_json: JSON.parse(row.insights_json as string),
    });
  });

  return router;
}
