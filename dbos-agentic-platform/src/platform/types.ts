/**
 * Contract every workflow module exposes to the platform.
 *
 * A workflow module is a self-contained vertical slice under workflows/<name>/.
 * The platform (server + worker) only knows about workflows through this shape,
 * so adding a workflow = create a folder + add its module to workflows/index.ts.
 */
import type { DBOSClient } from "@dbos-inc/dbos-sdk";
import type { Router } from "express";

export interface WorkflowModule {
  /** Workflow name — must match the name passed to DBOS.registerWorkflow. */
  name: string;
  /** Queue this workflow is enqueued onto. */
  queueName: string;
  /** Build the Express router exposing this workflow's HTTP endpoints (server). */
  buildRouter: (client: DBOSClient) => Router;
  /** Side-effect import that registers the workflow + steps with DBOS (worker only). */
  register: () => void;
}
