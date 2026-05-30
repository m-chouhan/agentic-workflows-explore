/**
 * Workflow registry — the single place that lists every workflow module.
 *
 * To add a workflow: create workflows/<name>/ (workflow.ts, steps/, schemas.ts,
 * routes.ts, constants.ts, index.ts) and append its module here. The server
 * mounts each module's router; the worker registers each module's workflow + queue.
 */
import type { WorkflowModule } from "../platform/types";
import { scanAndFixModule } from "./scan-and-fix";

export const workflowModules: WorkflowModule[] = [scanAndFixModule];
