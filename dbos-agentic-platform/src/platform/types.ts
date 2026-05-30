// Adding a workflow = create workflows/<name>/ + append to workflows/index.ts.
import type { DBOSClient } from "@dbos-inc/dbos-sdk";
import type { Router } from "express";

export interface WorkflowModule {
  name: string;         // must match the name passed to DBOS.registerWorkflow
  queueName: string;
  schemaPath: string;   // absolute path to this workflow's schema.sql (use path.join(__dirname, "schema.sql"))
  buildRouter: (client: DBOSClient) => Router;
  register: () => void; // side-effect import that registers the workflow with DBOS (worker only)
}
