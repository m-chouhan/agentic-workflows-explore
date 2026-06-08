// To add a workflow: create workflows/<name>/ and append its module here.
import type { WorkflowModule } from "../platform/types";
import { scanAndFixModule } from "./scan-and-fix";
import { bitbucketPrStatusModule } from "./bitbucket-pr-status";

export const workflowModules: WorkflowModule[] = [scanAndFixModule, bitbucketPrStatusModule];
