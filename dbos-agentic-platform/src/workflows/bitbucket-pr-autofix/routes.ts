import { Router, Request, Response } from "express";
import { DBOSClient } from "@dbos-inc/dbos-sdk";
import { z } from "zod";
import { QUEUE_NAME, WORKFLOW_NAME } from "./constants";

// Union: exactly one of { repo } or { statusWorkflowId } must be provided.
const PrAutofixRequestSchema = z.union([
  z.object({
    repo: z
      .string()
      .min(1)
      .regex(/^[^/]+\/[^/]+$/, "repo must be in workspace/slug format (e.g. atlassian/dt-proc)"),
  }),
  z.object({
    statusWorkflowId: z.string().min(1),
  }),
]);

export function buildPrAutofixRouter(client: DBOSClient): Router {
  const router = Router();

  router.post("/pr-autofix", async (req: Request, res: Response) => {
    const parsed = PrAutofixRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", details: parsed.error.format() });
      return;
    }

    const input = "repo" in parsed.data
      ? { source: "discover" as const, repo: parsed.data.repo }
      : { source: "reuse" as const, statusWorkflowId: parsed.data.statusWorkflowId };

    const tag = "repo" in parsed.data
      ? parsed.data.repo.replace("/", "-")
      : `from-${parsed.data.statusWorkflowId}`;
    const workflowId = `pr-autofix-${tag}-${Date.now()}`;

    try {
      await client.enqueue(
        { queueName: QUEUE_NAME, workflowName: WORKFLOW_NAME, workflowID: workflowId },
        input,
      );
      res.status(202).json({
        workflowId,
        status: "ENQUEUED",
        pollUrl: `/workflow/pr-autofix/${workflowId}`,
      });
    } catch (err) {
      res.status(500).json({ error: "enqueue_failed", message: (err as Error).message });
    }
  });

  router.get("/pr-autofix/:id", async (req: Request, res: Response) => {
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
