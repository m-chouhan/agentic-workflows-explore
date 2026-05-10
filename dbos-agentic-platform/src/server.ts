// App server — Express + DBOSClient. Enqueues workflows by string name only;
import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import { DBOSClient } from "@dbos-inc/dbos-sdk";
import { ensureSchema } from "./db/postgres";
import { buildSalesRouter } from "./api/salesRoutes";
import { buildVulnRouter } from "./api/vulnRoutes";

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);

async function main(): Promise<void> {
  const { PGHOST: host = "localhost", PGPORT: port = "5432",
          PGUSER: user = "dbos", PGPASSWORD: password = "dbos",
          PGDATABASE: database = "dbos_sales" } = process.env;

  const databaseUrl = `postgresql://${user}:${password}@${host}:${port}/${database}?connect_timeout=10&sslmode=disable`;

  // Ensure business-data tables exist in the same Postgres used by DBOS
  await ensureSchema();

  const client = await DBOSClient.create({ systemDatabaseUrl: databaseUrl });
  console.log("[server] DBOSClient connected");

  const app = express();
  app.use(express.json());
  app.use(buildSalesRouter(client));
  app.use(buildVulnRouter(client));

  app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
    console.log(`  ── Sales PoC ──`);
    console.log(`  POST /api/analyze  { "year": 2025 }`);
    console.log(`  GET  /api/analyze/:id`);
    console.log(`  GET  /api/insights/:year`);
    console.log(`  ── Vuln Fix PoC ──`);
    console.log(`  POST /api/scan     { "repo": "owner/name", "branch": "main" }`);
    console.log(`  GET  /api/scan/:id`);
    console.log(`  GET  /api/findings/:repo`);
  });

  process.on("SIGTERM", async () => { await client.destroy(); process.exit(0); });
}

main().catch((err) => { console.error("[server] fatal:", err); process.exit(1); });
