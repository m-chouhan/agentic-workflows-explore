import * as path from "path";
import type { WorkflowModule } from "../../platform/types";
import { buildVulnRouter } from "./routes";
import { VULN_QUEUE_NAME, SCAN_AND_FIX_WORKFLOW } from "./constants";

export const scanAndFixModule: WorkflowModule = {
  name: SCAN_AND_FIX_WORKFLOW,
  queueName: VULN_QUEUE_NAME,
  schemaPath: path.join(__dirname, "schema.sql"),
  buildRouter: buildVulnRouter,
  register: () => { require("./workflow"); },
};
