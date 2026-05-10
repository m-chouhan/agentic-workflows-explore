// DBOS workflow: read sales → aggregate → analyse → write insights.
import { DBOS } from "@dbos-inc/dbos-sdk";
import { query, queryOne } from "../db/postgres";
import { analyzeSales, AggregatedSales, AnalysisResult } from "../agent/salesAnalysisAgent";

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
  const rows = await query<SalesRow>(
    `SELECT order_date, product, region, units, revenue
     FROM sales
     WHERE order_date >= $1 AND order_date < $2
     ORDER BY order_date ASC`,
    [`${year}-01-01`, `${year + 1}-01-01`],
  );
  DBOS.logger.info(`[worker] readSalesData: ${rows.length} rows for ${year}`);
  return rows;
}

async function aggregateSales(year: number, rows: SalesRow[]): Promise<AggregatedSales> {
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

  DBOS.logger.info(`[worker] aggregateSales: total=$${aggregated.totalRevenue}, products=${aggregated.byProduct.length}`);
  return aggregated;
}

async function runAnalysisAgent(aggregated: AggregatedSales): Promise<AnalysisResult> {
  DBOS.logger.info(`[worker] runAnalysisAgent: invoking for ${aggregated.year}`);
  return analyzeSales(aggregated);
}

async function writeInsights(
  workflowId: string,
  year: number,
  aggregated: AggregatedSales,
  analysis: AnalysisResult,
): Promise<number> {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO sales_insights
       (workflow_id, year, generated_at, total_revenue, total_units,
        top_product, top_region, summary, insights_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT(workflow_id) DO UPDATE SET
       generated_at  = EXCLUDED.generated_at,
       total_revenue = EXCLUDED.total_revenue,
       total_units   = EXCLUDED.total_units,
       top_product   = EXCLUDED.top_product,
       top_region    = EXCLUDED.top_region,
       summary       = EXCLUDED.summary,
       insights_json = EXCLUDED.insights_json
     RETURNING id`,
    [
      workflowId, year, new Date().toISOString(),
      aggregated.totalRevenue, aggregated.totalUnits,
      analysis.topProduct, analysis.topRegion,
      analysis.summary, JSON.stringify({ aggregated, analysis }),
    ],
  );
  if (!row) throw new Error("writeInsights returned no row");
  DBOS.logger.info(`[worker] writeInsights: persisted id=${row.id}`);
  return row.id;
}

async function analyzeYear(year: number): Promise<AnalyzeWorkflowResult> {
  const workflowId = DBOS.workflowID ?? `wf-${Date.now()}`;
  DBOS.logger.info(`[worker] ▶ analyzeYear(${year})  workflowId=${workflowId}`);

  const rows       = await DBOS.runStep(() => readSalesData(year));
  const aggregated = await DBOS.runStep(() => aggregateSales(year, rows));

  let analysis: AnalysisResult;
  try {
    analysis = await DBOS.runStep(() => runAnalysisAgent(aggregated), {
      retriesAllowed: true, maxAttempts: 2, intervalSeconds: 5, backoffRate: 1,
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

  DBOS.logger.info(`[worker] ✓ analyzeYear done  workflowId=${workflowId}  insightsId=${insightsId}  revenue=$${aggregated.totalRevenue}`);
  return { workflowId, year, insightsId, analysis };
}

export const analyzeYearWorkflow = DBOS.registerWorkflow(analyzeYear, { name: "analyzeYear" });
