/**
 * Entry point — boots DBOS, registers workflow classes, then starts Express.
 */
import "reflect-metadata";
import * as dotenv from "dotenv";
dotenv.config(); // load .env before anything reads process.env
import express from "express";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { buildRouter } from "./api/routes";
import { SalesAnalysisWorkflow } from "./workflows/analyzeSales";
import { getDb } from "./db/sqlite";

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);

async function main(): Promise<void> {
  // Ensure SQLite schema is in place before any workflow runs.
  getDb();

  // Register the workflow class with DBOS by referencing it (decorators run at
  // import time). The explicit reference also prevents tree-shaking.
  void SalesAnalysisWorkflow;

  // Build the Postgres connection URL from env vars (set in .env / docker-compose).
  const host     = process.env.PGHOST     ?? "localhost";
  const port     = process.env.PGPORT     ?? "5432";
  const user     = process.env.PGUSER     ?? "dbos";
  const password = process.env.PGPASSWORD ?? "dbos";
  const database = process.env.PGDATABASE ?? "dbos_sales";

  const databaseUrl = `postgresql://${user}:${password}@${host}:${port}/${database}?connect_timeout=10&sslmode=disable`;

  // Pass config explicitly — DBOS v2 library mode reads setConfig(), not dbos-config.yaml.
  // runAdminServer:false avoids a Koa compatibility crash on Node 20 with this SDK version.
  DBOS.setConfig({ databaseUrl, runAdminServer: false });

  // Launch DBOS (connects to Postgres, runs migrations, starts the executor).
  await DBOS.launch();

  const app = express();
  app.use(express.json());
  app.use(buildRouter());

  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[poc-dbos-sales] listening on http://localhost:${PORT}`);
    // eslint-disable-next-line no-console
    console.log(`  POST /api/analyze        { "year": 2025 }`);
    // eslint-disable-next-line no-console
    console.log(`  GET  /api/analyze/:id`);
    // eslint-disable-next-line no-console
    console.log(`  GET  /api/insights/:year`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup error:", err);
  process.exit(1);
});
