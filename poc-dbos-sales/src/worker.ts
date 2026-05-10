// Worker — DBOS executor. Owns all workflow/step definitions; has no HTTP server.
// Enqueued work arrives via shared Postgres; app server uses DBOSClient to submit it.
import * as dotenv from "dotenv";
dotenv.config();

import { DBOS } from "@dbos-inc/dbos-sdk";
import { getDb } from "./db/sqlite";

// Importing registers the workflow with DBOS (registerWorkflow runs at import time).
import "./workflows/analyzeSales";

export const ANALYSIS_QUEUE_NAME = "analysis-queue";

async function main(): Promise<void> {
  getDb(); // bootstrap SQLite schema

  const { PGHOST: host = "localhost", PGPORT: port = "5432",
          PGUSER: user = "dbos", PGPASSWORD: password = "dbos",
          PGDATABASE: database = "dbos_sales" } = process.env;

  const databaseUrl = `postgresql://${user}:${password}@${host}:${port}/${database}?connect_timeout=10&sslmode=disable`;

  // DBOS_EXECUTOR_ID: set to pod name in K8s (Downward API: metadata.name) for
  // correct crash-recovery scoping. Defaults to pid for local dev.
  const executorId = process.env.DBOS_EXECUTOR_ID ?? `worker-${process.pid}`;

  DBOS.setConfig({ systemDatabaseUrl: databaseUrl, runAdminServer: false });
  await DBOS.launch();

  await DBOS.registerQueue(ANALYSIS_QUEUE_NAME);

  DBOS.logger.info(`[worker] launched  pid=${process.pid}  executorId=${executorId}  queue="${ANALYSIS_QUEUE_NAME}"`);

  const shutdown = async () => { await DBOS.shutdown(); process.exit(0); };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT",  shutdown);

  await new Promise<never>(() => { /* block — DBOS polling loop runs in background */ });
}

main().catch((err) => { console.error("[worker] fatal:", err); process.exit(1); });
