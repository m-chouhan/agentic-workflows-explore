import * as path from "path";
import { DBOS } from "@dbos-inc/dbos-sdk";
import type { WorkflowModule } from "../../platform/types";
import { listPullRequests } from "../../platform/bitbucket";
import { buildPlatformSmokeRouter } from "./routes";
import { QUEUE_NAME, WORKFLOW_NAME } from "./constants";
import { writeSmokeRun } from "./steps/persist";
import type { SmokeResult } from "./schemas";

/**
 * Platform smoke canary. Deliberately minimal: pull ONE PR of any state and
 * persist a single row. Its only purpose is to exercise the durable path
 * (enqueue → worker → step → Postgres) cheaply and deterministically.
 * Feature workflows (pr-status, pr-autofix) carry the real business logic.
 */
async function platformSmoke(repo: string): Promise<SmokeResult> {
  const workflowId = DBOS.workflowID ?? `smoke-${Date.now()}`;
  DBOS.logger.info(`[smoke] ▶ platformSmoke(${repo})  wfId=${workflowId}`);

  const prs = await DBOS.runStep(
    () => listPullRequests(repo, { state: "ALL", limit: 1 }),
    { name: "fetch-one-pr", retriesAllowed: true, maxAttempts: 2, intervalSeconds: 3, backoffRate: 1 },
  );

  const pr = prs[0] ?? null;
  const prId = pr?.id ?? null;
  const prState = pr ? "PRESENT" : "NONE";

  await DBOS.runStep(
    () => writeSmokeRun(workflowId, repo, prId, prState),
    { name: "persist" },
  );

  DBOS.logger.info(`[smoke] ✓ done  wfId=${workflowId}  prId=${prId}  state=${prState}`);

  return { workflowId, repo, prId, prState, persisted: true, status: "completed" };
}

const platformSmokeWorkflow = DBOS.registerWorkflow(platformSmoke, { name: WORKFLOW_NAME });

export const platformSmokeModule: WorkflowModule = {
  name: WORKFLOW_NAME,
  queueName: QUEUE_NAME,
  schemaPath: path.join(__dirname, "schema.sql"),
  buildRouter: buildPlatformSmokeRouter,
  register: () => { void platformSmokeWorkflow; },
};
