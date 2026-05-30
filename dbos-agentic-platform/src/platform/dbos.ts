// Workflows must be registered (imported) BEFORE calling launchWorker().
import { DBOS, DBOSClient } from "@dbos-inc/dbos-sdk";
import { getDatabaseUrl } from "./config";

export async function createDbosClient(): Promise<DBOSClient> {
  return DBOSClient.create({ systemDatabaseUrl: getDatabaseUrl() });
}

export async function launchWorker(queueNames: string[]): Promise<void> {
  const executorId = process.env.DBOS_EXECUTOR_ID ?? `worker-${process.pid}`;
  DBOS.setConfig({ systemDatabaseUrl: getDatabaseUrl(), runAdminServer: false, executorID: executorId });
  await DBOS.launch();
  for (const q of queueNames) await DBOS.registerQueue(q);
  DBOS.logger.info(
    `[worker] launched  pid=${process.pid}  executorId=${executorId}  queues=${queueNames.join(",")}`,
  );
}
