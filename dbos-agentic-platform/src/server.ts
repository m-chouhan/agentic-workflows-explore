import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import { DBOSClient } from "@dbos-inc/dbos-sdk";
import { ensureSchema } from "./db/postgres";
import { getDatabaseUrl } from "./config";
import { buildVulnRouter } from "./api/vulnRoutes";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

async function main(): Promise<void> {
  const databaseUrl = getDatabaseUrl();

  await ensureSchema();

  const client = await DBOSClient.create({ systemDatabaseUrl: databaseUrl });
  console.log("[server] DBOSClient connected");

  const app = express();
  app.use(express.json());

  app.get("/healthz", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

  app.use("/workflow", buildVulnRouter(client));

  app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
    console.log(`  POST /workflow/scan      { "repo": "owner/name", "branch": "main" }`);
    console.log(`  GET  /healthz`);
  });

  process.on("SIGTERM", async () => { await client.destroy(); process.exit(0); });
}

main().catch((err) => { console.error("[server] fatal:", err); process.exit(1); });
