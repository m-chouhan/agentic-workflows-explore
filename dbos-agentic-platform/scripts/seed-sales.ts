/**
 * Seeds ~1 year of fake sales data into Postgres.
 * Usage: npm run seed
 */
import * as dotenv from "dotenv";
dotenv.config();

import { ensureSchema, query, closePool } from "../src/db/postgres";

const PRODUCTS = [
  { product: "Atlas Widget",  category: "Widgets",     basePrice: 19.99 },
  { product: "Atlas Pro",     category: "Widgets",     basePrice: 49.99 },
  { product: "Bolt Kit",      category: "Hardware",    basePrice: 12.5  },
  { product: "Cloud Monitor", category: "Software",    basePrice: 99.0  },
  { product: "Datapack 100",  category: "Software",    basePrice: 29.0  },
  { product: "Edge Sensor",   category: "Hardware",    basePrice: 75.0  },
];
const REGIONS = ["NA", "EMEA", "APAC", "LATAM"];

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  await ensureSchema();

  const existing = await query<{ n: string }>("SELECT COUNT(*) AS n FROM sales");
  const count = Number(existing[0].n);
  if (count > 0) {
    console.log(`sales table already has ${count} rows; truncating and reseeding.`);
    await query("DELETE FROM sales");
  }

  const today = new Date();
  let totalRows = 0;

  // Insert in daily batches to keep individual queries reasonable
  for (let dayOffset = 365; dayOffset >= 0; dayOffset--) {
    const d = new Date(today);
    d.setDate(d.getDate() - dayOffset);
    const ordersToday = randInt(5, 25);

    const values: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    for (let i = 0; i < ordersToday; i++) {
      const p = PRODUCTS[randInt(0, PRODUCTS.length - 1)];
      const region = REGIONS[randInt(0, REGIONS.length - 1)];
      const units = randInt(1, 12);
      const unitPrice = +(p.basePrice * (0.9 + Math.random() * 0.2)).toFixed(2);
      const revenue = +(units * unitPrice).toFixed(2);

      values.push(`($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3}, $${paramIdx+4}, $${paramIdx+5}, $${paramIdx+6})`);
      params.push(isoDate(d), p.product, p.category, region, units, unitPrice, revenue);
      paramIdx += 7;
    }

    await query(
      `INSERT INTO sales (order_date, product, category, region, units, unit_price, revenue)
       VALUES ${values.join(", ")}`,
      params,
    );
    totalRows += ordersToday;
  }

  console.log(`Seeded ${totalRows} sales rows across ~366 days.`);
  await closePool();
}

main().catch((err) => { console.error("seed failed:", err); process.exit(1); });
