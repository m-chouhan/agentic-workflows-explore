import { Router, Request, Response } from "express";
import { DBOSClient } from "@dbos-inc/dbos-sdk";
import { z } from "zod";
import { QUEUE_NAME, WORKFLOW_NAME } from "./constants";

const SmokeRequestSchema = z.object({
  repo: z
    .string()
    .min(1)
    .regex(/^[^/]+\/[^/]+$/, "repo must be in workspace/slug format (e.g. atlassian/dt-proc)"),
});

export function buildPlatformSmokeRouter(client: DBOSClient): Router {
  const router = Router();

  router.post("/smoke", async (req: Request, res: Response) => {
    const parsed = SmokeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", details: parsed.error.format() });
      return;
    }
    const { repo } = parsed.data;
    const workflowId = `smoke-${repo.replace("/", "-")}-${Date.now()}`;

    try {
      await client.enqueue(
        { queueName: QUEUE_NAME, workflowName: WORKFLOW_NAME, workflowID: workflowId },
        repo,
      );
      res.status(202).json({
        workflowId,
        status: "ENQUEUED",
        pollUrl: `/workflow/smoke/${workflowId}`,
      });
    } catch (err) {
      res.status(500).json({ error: "enqueue_failed", message: (err as Error).message });
    }
  });

  router.get("/smoke/:id", async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      const wf = await client.getWorkflow(id);
      if (!wf) { res.status(404).json({ error: "not_found", workflowId: id }); return; }
      if (wf.status === "ERROR") {
        const message = (wf.error as Error | undefined)?.message ?? "workflow failed";
        res.status(500).json({ workflowId: id, status: wf.status, error: { message } });
        return;
      }
      const body: Record<string, unknown> = { workflowId: id, status: wf.status };
      if (wf.status === "SUCCESS") body.result = wf.output;
      res.json(body);
    } catch (err) {
      res.status(500).json({ error: "lookup_failed", message: (err as Error).message });
    }
  });

  return router;
}
