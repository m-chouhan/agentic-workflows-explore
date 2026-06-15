import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import type { DBOSClient } from "@dbos-inc/dbos-sdk";
import { buildPrStatusRouter } from "./routes";

// Mocks only the DBOSClient boundary; the Express layer runs for real.
type MockClient = {
  enqueue: ReturnType<typeof jest.fn>;
  getWorkflow: ReturnType<typeof jest.fn>;
};

describe("bitbucket-pr-status routes", () => {
  let client: MockClient;
  let app: express.Express;

  beforeEach(() => {
    client = { enqueue: jest.fn(), getWorkflow: jest.fn() };
    app = express().use(express.json());
    app.use("/workflow", buildPrStatusRouter(client as unknown as DBOSClient));
  });

  it("rejects an invalid repo with 400 and does not enqueue", async () => {
    const res = await request(app).post("/workflow/pr-status").send({ repo: "notavalidrepo" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(client.enqueue).not.toHaveBeenCalled();
  });

  it("enqueues a valid repo and returns 202 with a poll URL", async () => {
    const res = await request(app).post("/workflow/pr-status").send({ repo: "atlassian/dt-proc" });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe("ENQUEUED");
    expect(res.body.pollUrl).toBe(`/workflow/pr-status/${res.body.workflowId}`);

    const [opts, repo] = client.enqueue.mock.calls[0] as [Record<string, unknown>, string];
    expect(opts).toMatchObject({ queueName: "bitbucket-pr-queue", workflowName: "bitbucketPrStatus" });
    expect(repo).toBe("atlassian/dt-proc");
  });

  it("returns 404 when the polled workflow is unknown", async () => {
    client.getWorkflow.mockResolvedValueOnce(null);
    const res = await request(app).get("/workflow/pr-status/missing");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("returns the workflow output once it succeeds", async () => {
    client.getWorkflow.mockResolvedValueOnce({ status: "SUCCESS", output: { totalPrs: 2, failedCount: 1 } });
    const res = await request(app).get("/workflow/pr-status/wf-1");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("SUCCESS");
    expect(res.body.result).toEqual({ totalPrs: 2, failedCount: 1 });
  });
});
