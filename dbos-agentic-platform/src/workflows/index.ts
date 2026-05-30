// To add a workflow: create workflows/<name>/ and append its module here.
import type { WorkflowModule } from "../platform/types";
import { scanAndFixModule } from "./scan-and-fix";

export const workflowModules: WorkflowModule[] = [scanAndFixModule];
