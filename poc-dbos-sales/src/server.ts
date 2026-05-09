// App server — Express + DBOSClient. Enqueues workflows by string name only;
// zero workflow code imported. Coordinates with worker via shared Postgres.
import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import { DBOSClient } from "@dbos-inc/dbos-sdk";
import { buildRouter } from "./api/routes";

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);

async function main(): Promise<void> {
  const { PGHOST: host = "localhost", PGPORT: port = "5432",
          PGUSER: user = "dbos", PGPASSWORD: password = "dbos",
          PGDATABASE: database = "dbos_sales" } = process.env;

  const databaseUrl = `postgresql://${user}:${password}@${host}:${port}/${database}?connect_timeout=10&sslmode=disable`;

  const client = await DBOSClient.create({ systemDatabaseUrl: databaseUrl });
  console.log("[server] DBOSClient connected");

  const app = express();
  app.use(express.json());
  app.use(buildRouter(client));

  app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
    console.log(`  POST /api/analyze  { "year": 2025 }`);
    console.log(`  GET  /api/analyze/:id`);
    console.log(`  GET  /api/insights/:year`);
  });

  process.on("SIGTERM", async () => { await client.destroy(); process.exit(0); });
}

main().catch((err) => { console.error("[server] fatal:", err); process.exit(1); });
