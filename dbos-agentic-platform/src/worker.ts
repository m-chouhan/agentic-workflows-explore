// Worker — DBOS executor. Owns all workflow/step definitions; has no HTTP server.
// Enqueued work arrives via shared Postgres; app server uses DBOSClient to submit it.
import * as dotenv from "dotenv";
dotenv.config();

import { DBOS } from "@dbos-inc/dbos-sdk";
import { ensureSchema } from "./db/postgres";

// Importing registers workflows with DBOS (registerWorkflow runs at import time).
import "./workflows/analyzeSales";
import "./workflows/scanAndFix";

export const ANALYSIS_QUEUE_NAME = "analysis-queue";
export const VULN_QUEUE_NAME = process.env.VULN_QUEUE_NAME ?? "vuln-queue";

async function bootstrapDbOs(): Promise<void> {
  const { PGHOST: host = "localhost", PGPORT: port = "5432",
    PGUSER: user = "dbos", PGPASSWORD: password = "dbos",
    PGDATABASE: database = "dbos_sales" } = process.env;

  const databaseUrl = `postgresql://${user}:${password}@${host}:${port}/${database}?connect_timeout=10&sslmode=disable`;

  const executorId = process.env.DBOS_EXECUTOR_ID ?? `worker-${process.pid}`;

  DBOS.setConfig({ systemDatabaseUrl: databaseUrl, runAdminServer: false, executorID: executorId });
  await DBOS.launch();

  await DBOS.registerQueue(ANALYSIS_QUEUE_NAME);
  await DBOS.registerQueue(VULN_QUEUE_NAME);

  DBOS.logger.info(`[worker] launched  pid=${process.pid}  executorId=${executorId}  queues="${ANALYSIS_QUEUE_NAME}","${VULN_QUEUE_NAME}"`);
}

async function main(): Promise<void> {
  await ensureSchema();
  await bootstrapDbOs();

  const shutdown = async () => { await DBOS.shutdown(); process.exit(0); };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT",  shutdown);

  await new Promise<never>(() => { /* block — DBOS polling loop runs in background */ });
}

main().catch((err) => { console.error("[worker] fatal:", err); process.exit(1); });
