// DBOS workflow: read sales → aggregate → analyse → write insights.
import { DBOS } from "@dbos-inc/dbos-sdk";
import { getDb } from "../db/sqlite";
import { analyzeSales, AggregatedSales, AnalysisResult } from "../agent/mockAgent";

interface SalesRow {
  order_date: string;
  product: string;
  region: string;
  units: number;
  revenue: number;
}

export interface AnalyzeWorkflowResult {
  workflowId: string;
  year: number;
  insightsId: number;
  analysis: AnalysisResult;
}

async function readSalesData(year: number): Promise<SalesRow[]> {
  await new Promise((r) => setTimeout(r, 2000));
  const rows = getDb()
    .prepare(
      `SELECT order_date, product, region, units, revenue
       FROM sales
       WHERE order_date >= ? AND order_date < ?
       ORDER BY order_date ASC`,
    )
    .all(`${year}-01-01`, `${year + 1}-01-01`) as SalesRow[];
  DBOS.logger.info(`[worker]   step1/readSalesData: ${rows.length} rows for ${year}`);
  return rows;
}

async function aggregateSales(year: number, rows: SalesRow[]): Promise<AggregatedSales> {
  await new Promise((r) => setTimeout(r, 2000));
  const byProductMap = new Map<string, { revenue: number; units: number }>();
  const byRegionMap  = new Map<string, number>();
  const byMonthMap   = new Map<string, number>();
  let totalRevenue = 0;
  let totalUnits   = 0;

  for (const r of rows) {
    totalRevenue += r.revenue;
    totalUnits   += r.units;
    const p = byProductMap.get(r.product) ?? { revenue: 0, units: 0 };
    p.revenue += r.revenue;
    p.units   += r.units;
    byProductMap.set(r.product, p);
    byRegionMap.set(r.region, (byRegionMap.get(r.region) ?? 0) + r.revenue);
    const month = r.order_date.slice(0, 7);
    byMonthMap.set(month, (byMonthMap.get(month) ?? 0) + r.revenue);
  }

  const aggregated: AggregatedSales = {
    year,
    totalRevenue: +totalRevenue.toFixed(2),
    totalUnits,
    byProduct: [...byProductMap.entries()]
      .map(([product, v]) => ({ product, revenue: +v.revenue.toFixed(2), units: v.units }))
      .sort((a, b) => b.revenue - a.revenue),
    byRegion: [...byRegionMap.entries()]
      .map(([region, revenue]) => ({ region, revenue: +revenue.toFixed(2) }))
      .sort((a, b) => b.revenue - a.revenue),
    byMonth: [...byMonthMap.entries()]
      .map(([month, revenue]) => ({ month, revenue: +revenue.toFixed(2) }))
      .sort((a, b) => a.month.localeCompare(b.month)),
  };

  DBOS.logger.info(`[worker]   step2/aggregateSales: total=$${aggregated.totalRevenue}, products=${aggregated.byProduct.length}`);
  return aggregated;
}

async function runAnalysisAgent(aggregated: AggregatedSales): Promise<AnalysisResult> {
  DBOS.logger.info(`[worker]   step3/runAnalysisAgent: invoking mock agent for ${aggregated.year}`);
  return analyzeSales(aggregated);
}

async function writeInsights(
  workflowId: string,
  year: number,
  aggregated: AggregatedSales,
  analysis: AnalysisResult,
): Promise<number> {
  const result = getDb()
    .prepare(
      `INSERT INTO sales_insights
         (workflow_id, year, generated_at, total_revenue, total_units,
          top_product, top_region, summary, insights_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workflow_id) DO UPDATE SET
         generated_at  = excluded.generated_at,
         total_revenue = excluded.total_revenue,
         total_units   = excluded.total_units,
         top_product   = excluded.top_product,
         top_region    = excluded.top_region,
         summary       = excluded.summary,
         insights_json = excluded.insights_json
       RETURNING id`,
    )
    .get(
      workflowId, year, new Date().toISOString(),
      aggregated.totalRevenue, aggregated.totalUnits,
      analysis.topProduct, analysis.topRegion,
      analysis.summary, JSON.stringify({ aggregated, analysis }),
    ) as { id: number };
  DBOS.logger.info(`[worker]   step4/writeInsights: persisted insights id=${result.id}`);
  return result.id;
}

async function analyzeYear(year: number): Promise<AnalyzeWorkflowResult> {
  const workflowId = DBOS.workflowID ?? `wf-${Date.now()}`;
  DBOS.logger.info(`[worker] ▶ WORKFLOW START  analyzeYear(${year})  workflowId=${workflowId}`);

  const rows       = await DBOS.runStep(() => readSalesData(year));
  const aggregated = await DBOS.runStep(() => aggregateSales(year, rows));

  let analysis: AnalysisResult;
  try {
    // Retry config: handles transient LLM 5xx / rate-limit errors.
    analysis = await DBOS.runStep(() => runAnalysisAgent(aggregated), {
      retriesAllowed: true, maxAttempts: 4, intervalSeconds: 2, backoffRate: 2,
    });
  } catch (err) {
    DBOS.logger.error(`runAnalysisAgent exhausted retries for ${year}: ${(err as Error).message}`);
    analysis = {
      summary:         `Analysis unavailable for ${year} — agent failed. Raw data captured.`,
      topProduct:      aggregated.byProduct[0]?.product ?? "unknown",
      topRegion:       aggregated.byRegion[0]?.region  ?? "unknown",
      highlights:      [`Total revenue: $${aggregated.totalRevenue}`, `Total units: ${aggregated.totalUnits}`],
      recommendations: ["Manual review required."],
      riskFlags:       ["Agent failure: analysis could not be completed automatically."],
    };
  }

  const insightsId = await DBOS.runStep(() => writeInsights(workflowId, year, aggregated, analysis));

  DBOS.logger.info(`[worker] ✓ WORKFLOW DONE  workflowId=${workflowId}  insightsId=${insightsId}  revenue=$${aggregated.totalRevenue}`);
  return { workflowId, year, insightsId, analysis };
}

export const analyzeYearWorkflow = DBOS.registerWorkflow(analyzeYear, { name: "analyzeYear" });
