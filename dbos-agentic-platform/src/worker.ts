// Worker — DBOS executor. Registers every workflow module and launches the
// DBOS runtime; no HTTP server. Enqueued work arrives via shared Postgres;
// the app server uses DBOSClient to submit it.
import * as dotenv from "dotenv";
dotenv.config();

import { DBOS } from "@dbos-inc/dbos-sdk";
import { ensureSchema } from "./platform/db";
import { launchWorker } from "./platform/dbos";
import { workflowModules } from "./workflows";

async function main(): Promise<void> {
  await ensureSchema();

  // Register all workflows (+ their steps) BEFORE launching DBOS.
  for (const m of workflowModules) m.register();

  await launchWorker(workflowModules.map((m) => m.queueName));

  const shutdown = async () => { await DBOS.shutdown(); process.exit(0); };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT",  shutdown);

  await new Promise<never>(() => {});
}

main().catch((err) => { console.error("[worker] fatal:", err); process.exit(1); });
