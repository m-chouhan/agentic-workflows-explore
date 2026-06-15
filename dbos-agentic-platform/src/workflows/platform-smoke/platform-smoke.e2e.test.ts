// Platform smoke test — the single e2e canary for the durable path.
//
// Purpose: prove the platform wiring works end-to-end:
//   HTTP enqueue → queue → worker → step → Postgres persist → poll → SUCCESS.
// The platformSmoke workflow pulls ONE PR (any state) and writes one row, so this
// stays fast and cheap. Feature logic lives in the int/unit tiers, not here.
//
// Requires `npm run stack:up` and BITBUCKET_TOKEN in the worker's .env.
import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { requireServerUp, runWorkflow, E2E_TIMEOUT_MS } from "../../../test/support/e2e";

const TEST_REPO = process.env.TEST_REPO ?? "atlassian/dt-proc";

jest.setTimeout(E2E_TIMEOUT_MS);

describe("platform smoke: durable workflow path", () => {
  beforeAll(requireServerUp, 30_000);

  it("enqueues a workflow, runs it, and persists a row to Postgres", async () => {
    // runWorkflow throws unless the workflow reaches SUCCESS — which only happens
    // after the persist step has written to Postgres. `persisted: true` echoed back
    // confirms the durable round-trip landed in the DB.
    const result = await runWorkflow("/workflow/smoke", { repo: TEST_REPO });

    expect(result.workflowId).toEqual(expect.any(String));
    expect(result.persisted).toBe(true);
  });
});
