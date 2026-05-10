// Sales analysis agent — uses Vercel AI SDK generateObject for structured LLM output.
// Same AggregatedSales → AnalysisResult contract as before; drop-in replacement.
import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";

export const AggregatedSalesSchema = z.object({
  year:         z.number().int(),
  totalRevenue: z.number(),
  totalUnits:   z.number().int(),
  byProduct: z.array(z.object({ product: z.string(), revenue: z.number(), units: z.number().int() })),
  byRegion:  z.array(z.object({ region: z.string(),  revenue: z.number() })),
  byMonth:   z.array(z.object({ month: z.string(),   revenue: z.number() })),
});
export type AggregatedSales = z.infer<typeof AggregatedSalesSchema>;

export const AnalysisResultSchema = z.object({
  summary:         z.string().describe("2-3 sentence executive summary of the year's performance"),
  topProduct:      z.string().describe("Name of the best-selling product by revenue"),
  topRegion:       z.string().describe("Name of the strongest region by revenue"),
  highlights:      z.array(z.string()).describe("3-5 key factual highlights with numbers"),
  recommendations: z.array(z.string()).describe("3 actionable business recommendations"),
  riskFlags:       z.array(z.string()).describe("Any risk signals detected in the data, empty array if none"),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export async function analyzeSales(data: AggregatedSales): Promise<AnalysisResult> {
  if (!data.byProduct.length || !data.byRegion.length) {
    throw new Error(`No sales data found for year ${data.year}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { object } = await (generateObject as any)({
    model: google((process.env.GOOGLE_MODEL ?? "gemini-2.0-flash") as any),
    schema: AnalysisResultSchema,
    prompt: [
      `You are a senior business analyst. Analyse the following sales data for ${data.year} and generate structured insights.`,
      `Be specific — use actual numbers from the data. Identify risks if revenue is declining or a product is underperforming.`,
      ``,
      `Sales data:`,
      JSON.stringify(data, null, 2),
    ].join("\n"),
  });

  return object as AnalysisResult;
}
