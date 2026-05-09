// Worker — DBOS executor. Owns all workflow/step definitions; has no HTTP server.
// Enqueued work arrives via shared Postgres; app server uses DBOSClient to submit it.
import * as dotenv from "dotenv";
dotenv.config();

import { DBOS, WorkflowQueue } from "@dbos-inc/dbos-sdk";
import { SalesAnalysisWorkflow } from "./workflows/analyzeSales";
import { getDb } from "./db/sqlite";

export const ANALYSIS_QUEUE_NAME = "analysis-queue";
export const analysisQueue = new WorkflowQueue(ANALYSIS_QUEUE_NAME);

async function main(): Promise<void> {
  getDb();          // bootstrap SQLite schema
  void SalesAnalysisWorkflow; // ensure decorators register at import time

  const { PGHOST: host = "localhost", PGPORT: port = "5432",
          PGUSER: user = "dbos", PGPASSWORD: password = "dbos",
          PGDATABASE: database = "dbos_sales" } = process.env;

  const databaseUrl = `postgresql://${user}:${password}@${host}:${port}/${database}?connect_timeout=10&sslmode=disable`;

  // DBOS_EXECUTOR_ID: set to pod name in K8s (Downward API: metadata.name) for
  // correct crash-recovery scoping. Defaults to pid for local dev.
  const executorId = process.env.DBOS_EXECUTOR_ID ?? `worker-${process.pid}`;

  DBOS.setConfig({ databaseUrl, runAdminServer: false });
  await DBOS.launch();

  console.log(`[worker] launched  pid=${process.pid}  executorId=${executorId}  queue="${ANALYSIS_QUEUE_NAME}"`);

  const shutdown = async () => { await DBOS.shutdown(); process.exit(0); };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT",  shutdown);

  await new Promise<never>(() => { /* block — DBOS polling loop runs in background */ });
}

main().catch((err) => { console.error("[worker] fatal:", err); process.exit(1); });
