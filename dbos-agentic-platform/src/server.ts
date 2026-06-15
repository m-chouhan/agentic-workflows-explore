import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import { ensureSchema } from "./platform/db";
import { createDbosClient } from "./platform/dbos";
import { workflowModules } from "./workflows";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

async function main(): Promise<void> {
  await ensureSchema(workflowModules.flatMap((m) => (m.schemaPath ? [m.schemaPath] : [])));

  const client = await createDbosClient();
  console.log("[server] DBOSClient connected");

  const app = express();
  app.use(express.json());

  // Log each request once the response is sent (skip /healthz noise).
  app.use((req, res, next) => {
    if (req.path === "/healthz") return next();
    const start = Date.now();
    res.on("finish", () => {
      console.log(`[server] ${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - start}ms)`);
    });
    next();
  });

  app.get("/healthz", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

  for (const m of workflowModules) {
    app.use("/workflow", m.buildRouter(client));
  }

  app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
    for (const m of workflowModules) {
      console.log(`  workflow: ${m.name}  (queue: ${m.queueName})`);
    }
    console.log(`  GET  /healthz`);
  });

  process.on("SIGTERM", async () => { await client.destroy(); process.exit(0); });
}

main().catch((err) => { console.error("[server] fatal:", err); process.exit(1); });
