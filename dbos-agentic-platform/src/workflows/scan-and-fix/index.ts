/**
 * scan-and-fix workflow module descriptor.
 *
 * `register()` lazily imports ./workflow (which calls DBOS.registerWorkflow at
 * import time) so the API server can mount the router without pulling in the
 * heavy workflow/step code — only the worker calls register().
 */
import type { WorkflowModule } from "../../platform/types";
import { buildVulnRouter } from "./routes";
import { VULN_QUEUE_NAME, SCAN_AND_FIX_WORKFLOW } from "./constants";

export const scanAndFixModule: WorkflowModule = {
  name: SCAN_AND_FIX_WORKFLOW,
  queueName: VULN_QUEUE_NAME,
  buildRouter: buildVulnRouter,
  register: () => {
    require("./workflow");
  },
};
