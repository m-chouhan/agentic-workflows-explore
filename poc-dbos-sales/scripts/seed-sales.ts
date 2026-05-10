/**
 * Seeds ~1 year of fake sales data into SQLite.
 * Usage: npm run seed
 */
import { bootstrapAndGetDb, closeDb } from "../src/db/sqlite";

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

function main(): void {
  const db = bootstrapAndGetDb();

  const existing = db.prepare("SELECT COUNT(*) AS n FROM sales").get() as { n: number };
  if (existing.n > 0) {
    console.log(`sales table already has ${existing.n} rows; truncating and reseeding.`);
    db.exec("DELETE FROM sales");
  }

  const insert = db.prepare(
    `INSERT INTO sales (order_date, product, category, region, units, unit_price, revenue)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const insertMany = db.transaction((rows: unknown[][]) => {
    for (const r of rows) insert.run(...r);
  });

  const today = new Date();
  const rows: unknown[][] = [];
  for (let dayOffset = 365; dayOffset >= 0; dayOffset--) {
    const d = new Date(today);
    d.setDate(d.getDate() - dayOffset);
    const ordersToday = randInt(5, 25);
    for (let i = 0; i < ordersToday; i++) {
      const p = PRODUCTS[randInt(0, PRODUCTS.length - 1)];
      const region = REGIONS[randInt(0, REGIONS.length - 1)];
      const units = randInt(1, 12);
      // Add a little price jitter for realism.
      const unitPrice = +(p.basePrice * (0.9 + Math.random() * 0.2)).toFixed(2);
      const revenue = +(units * unitPrice).toFixed(2);
      rows.push([isoDate(d), p.product, p.category, region, units, unitPrice, revenue]);
    }
  }

  insertMany(rows);
  console.log(`Seeded ${rows.length} sales rows across ~366 days.`);

  closeDb();
}

main();
