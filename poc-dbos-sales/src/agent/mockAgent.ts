// Mock analysis agent — swap the body of `analyzeSales` for a real LLM call
// while keeping the AggregatedSales → AnalysisResult contract identical.
import { z } from "zod";

export const AggregatedSalesSchema = z.object({
  year: z.number().int(),
  totalRevenue: z.number(),
  totalUnits: z.number().int(),
  byProduct: z.array(z.object({ product: z.string(), revenue: z.number(), units: z.number().int() })),
  byRegion:  z.array(z.object({ region: z.string(),  revenue: z.number() })),
  byMonth:   z.array(z.object({ month: z.string(),   revenue: z.number() })),
});
export type AggregatedSales = z.infer<typeof AggregatedSalesSchema>;

export const AnalysisResultSchema = z.object({
  summary:         z.string(),
  topProduct:      z.string(),
  topRegion:       z.string(),
  highlights:      z.array(z.string()),
  recommendations: z.array(z.string()),
  riskFlags:       z.array(z.string()),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export async function analyzeSales(data: AggregatedSales): Promise<AnalysisResult> {
  // byProduct / byRegion arrive pre-sorted desc by revenue from aggregateSales step.
  const topProduct = data.byProduct[0];
  const topRegion  = data.byRegion[0];

  if (!topProduct || !topRegion) {
    throw new Error(`No sales data found for year ${data.year}`);
  }

  const first = data.byMonth[0];
  const last  = data.byMonth[data.byMonth.length - 1];
  const momGrowth =
    first && last && first.revenue > 0
      ? ((last.revenue - first.revenue) / first.revenue) * 100
      : 0;

  const highlights: string[] = [
    `Total revenue for ${data.year}: $${data.totalRevenue.toFixed(2)} across ${data.totalUnits} units.`,
    `Best-selling product: ${topProduct.product} ($${topProduct.revenue.toFixed(2)}).`,
    `Strongest region: ${topRegion.region} ($${topRegion.revenue.toFixed(2)}).`,
    `Month-over-month revenue change (first vs last month): ${momGrowth.toFixed(1)}%.`,
  ];

  const recommendations: string[] = [
    `Double down on inventory for ${topProduct.product}.`,
    `Pilot a targeted campaign in ${topRegion.region} to widen the lead.`,
    momGrowth < 0
      ? "Investigate the late-year revenue dip; consider promotional pricing."
      : "Sustain growth trajectory; consider expanding SKU coverage.",
  ];

  const riskFlags: string[] = [];
  const lowestProduct = data.byProduct[data.byProduct.length - 1];
  if (lowestProduct && lowestProduct.revenue < topProduct.revenue * 0.05) {
    riskFlags.push(`${lowestProduct.product} is underperforming (<5% of top product).`);
  }
  if (momGrowth < -10) {
    riskFlags.push("Significant revenue contraction detected (>10% decline).");
  }

  const summary =
    `In ${data.year}, total revenue reached $${data.totalRevenue.toFixed(2)} ` +
    `with ${data.totalUnits} units sold. ${topProduct.product} led product revenue ` +
    `and ${topRegion.region} was the strongest region. ` +
    `Trajectory: ${momGrowth >= 0 ? "growth" : "contraction"} of ${momGrowth.toFixed(1)}%.`;

  await new Promise((r) => setTimeout(r, 50)); // simulate agent latency

  return { summary, topProduct: topProduct.product, topRegion: topRegion.region, highlights, recommendations, riskFlags };
}
