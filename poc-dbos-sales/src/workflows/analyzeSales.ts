/**
 * DBOS workflow: analyse a year of sales data and persist insights.
 *
 * Step boundaries:
 *   1. readSalesData       — pulls rows for the requested year from SQLite
 *   2. aggregateSales      — pure JS reducer (totals, byProduct, byRegion, byMonth)
 *   3. runAnalysisAgent    — calls the mock analysis agent (swap for real LLM later)
 *   4. writeInsights       — writes one row to sales_insights in SQLite
 *
 * Each step is a `@DBOS.step` so DBOS persists its output in Postgres.
 * If the process crashes mid-workflow, DBOS replays from the last completed step.
 */
import { DBOS } from "@dbos-inc/dbos-sdk";
import { getDb } from "../db/sqlite";
import {
  analyzeSales,
  AggregatedSales,
  AnalysisResult,
} from "../agent/mockAgent";

interface SalesRow {
  order_date: string;
  product: string;
  category: string;
  region: string;
  units: number;
  unit_price: number;
  revenue: number;
}

export interface AnalyzeWorkflowResult {
  workflowId: string;
  year: number;
  insightsId: number;
  analysis: AnalysisResult;
}

export class SalesAnalysisWorkflow {
  // --- Step 1: read raw sales rows for the given year ---------------------
  @DBOS.step()
  static async readSalesData(year: number): Promise<SalesRow[]> {
    const db = getDb();
    const start = `${year}-01-01`;
    const end = `${year + 1}-01-01`;
    const rows = db
      .prepare(
        `SELECT order_date, product, category, region, units, unit_price, revenue
         FROM sales
         WHERE order_date >= ? AND order_date < ?
         ORDER BY order_date ASC`,
      )
      .all(start, end) as SalesRow[];
    DBOS.logger.info(`readSalesData: ${rows.length} rows for ${year}`);
    return rows;
  }

  // --- Step 2: aggregate the rows into the agent's input shape ------------
  @DBOS.step()
  static async aggregateSales(
    year: number,
    rows: SalesRow[],
  ): Promise<AggregatedSales> {
    const byProductMap = new Map<string, { revenue: number; units: number }>();
    const byRegionMap = new Map<string, number>();
    const byMonthMap = new Map<string, number>();

    let totalRevenue = 0;
    let totalUnits = 0;

    for (const r of rows) {
      totalRevenue += r.revenue;
      totalUnits += r.units;

      const p = byProductMap.get(r.product) ?? { revenue: 0, units: 0 };
      p.revenue += r.revenue;
      p.units += r.units;
      byProductMap.set(r.product, p);

      byRegionMap.set(r.region, (byRegionMap.get(r.region) ?? 0) + r.revenue);

      const month = r.order_date.slice(0, 7); // yyyy-mm
      byMonthMap.set(month, (byMonthMap.get(month) ?? 0) + r.revenue);
    }

    const aggregated: AggregatedSales = {
      year,
      totalRevenue: +totalRevenue.toFixed(2),
      totalUnits,
      byProduct: [...byProductMap.entries()]
        .map(([product, v]) => ({
          product,
          revenue: +v.revenue.toFixed(2),
          units: v.units,
        }))
        .sort((a, b) => b.revenue - a.revenue),
      byRegion: [...byRegionMap.entries()]
        .map(([region, revenue]) => ({ region, revenue: +revenue.toFixed(2) }))
        .sort((a, b) => b.revenue - a.revenue),
      byMonth: [...byMonthMap.entries()]
        .map(([month, revenue]) => ({ month, revenue: +revenue.toFixed(2) }))
        .sort((a, b) => a.month.localeCompare(b.month)),
    };

    DBOS.logger.info(
      `aggregateSales: total=$${aggregated.totalRevenue}, products=${aggregated.byProduct.length}`,
    );
    return aggregated;
  }

  // --- Step 3: ask the agent for an analysis ------------------------------
  @DBOS.step()
  static async runAnalysisAgent(
    aggregated: AggregatedSales,
  ): Promise<AnalysisResult> {
    DBOS.logger.info(`runAnalysisAgent: invoking mock agent for ${aggregated.year}`);
    return await analyzeSales(aggregated);
  }

  // --- Step 4: persist insights to SQLite ---------------------------------
  @DBOS.step()
  static async writeInsights(
    workflowId: string,
    year: number,
    aggregated: AggregatedSales,
    analysis: AnalysisResult,
  ): Promise<number> {
    const db = getDb();
    const stmt = db.prepare(
      `INSERT INTO sales_insights
         (workflow_id, year, generated_at, total_revenue, total_units,
          top_product, top_region, summary, insights_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workflow_id) DO UPDATE SET
         generated_at = excluded.generated_at,
         total_revenue = excluded.total_revenue,
         total_units   = excluded.total_units,
         top_product   = excluded.top_product,
         top_region    = excluded.top_region,
         summary       = excluded.summary,
         insights_json = excluded.insights_json
       RETURNING id`,
    );
    const result = stmt.get(
      workflowId,
      year,
      new Date().toISOString(),
      aggregated.totalRevenue,
      aggregated.totalUnits,
      analysis.topProduct,
      analysis.topRegion,
      analysis.summary,
      JSON.stringify({ aggregated, analysis }),
    ) as { id: number };
    DBOS.logger.info(`writeInsights: persisted insights id=${result.id}`);
    return result.id;
  }

  // --- The durable workflow that ties the steps together ------------------
  @DBOS.workflow()
  static async analyzeYear(year: number): Promise<AnalyzeWorkflowResult> {
    const workflowId = DBOS.workflowID ?? `wf-${Date.now()}`;
    DBOS.logger.info(`analyzeYear(${year}) starting; workflowId=${workflowId}`);

    const rows = await SalesAnalysisWorkflow.readSalesData(year);
    const aggregated = await SalesAnalysisWorkflow.aggregateSales(year, rows);
    const analysis = await SalesAnalysisWorkflow.runAnalysisAgent(aggregated);
    const insightsId = await SalesAnalysisWorkflow.writeInsights(
      workflowId,
      year,
      aggregated,
      analysis,
    );

    return { workflowId, year, insightsId, analysis };
  }
}
