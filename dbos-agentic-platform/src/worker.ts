import * as dotenv from "dotenv";
dotenv.config();

import { DBOS } from "@dbos-inc/dbos-sdk";
import { ensureSchema } from "./platform/db";
import { launchWorker } from "./platform/dbos";
import { workflowModules } from "./workflows";

async function main(): Promise<void> {
  await ensureSchema(workflowModules.map((m) => m.schemaPath));
  for (const m of workflowModules) m.register(); // must happen before DBOS.launch()

  await launchWorker(workflowModules.map((m) => m.queueName));

  const shutdown = async () => { await DBOS.shutdown(); process.exit(0); };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT",  shutdown);

  await new Promise<never>(() => {});
}

main().catch((err) => { console.error("[worker] fatal:", err); process.exit(1); });
