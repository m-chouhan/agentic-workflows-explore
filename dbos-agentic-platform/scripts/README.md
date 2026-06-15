# scripts/

Run-and-test helpers for the DBOS agentic platform.

## Stack management

| Command | What it does |
|---|---|
| `npm run stack:up` | Start postgres + worker + app-server, wait for `/healthz` |
| `npm run stack:up:rebuild` | Same, but rebuild images first (use after code changes) |
| `npm run stack:down` | Stop containers (postgres volume preserved) |
| `npm run stack:down -- --wipe` | Stop **and** drop the postgres volume — destroys all history |
| `npm run stack:logs` | Tail logs for all services |
| `npm run stack:logs worker` | Tail logs for one service |

`run-local.sh` requires `.env` to exist (copy from `.env.example`) — failing fast there avoids
"works on my machine" mysteries.

## End-to-end tests

E2E tests are Jest suites co-located with their workflow (`src/workflows/<name>/<name>.e2e.test.ts`),
not shell scripts. They drive a real workflow through the full stack (server → queue → worker →
DB → poll endpoint) and assert only the durable path that unit/integration tiers can't — input
validation and status mapping live in `*.int.test.ts`. See `knowledge/testing-strategy_20260608.md`.

```bash
npm run stack:up      # start postgres + worker + app-server
npm run test:e2e      # run all src/**/*.e2e.test.ts
```

### Env overrides

| Var | Default | Purpose |
|---|---|---|
| `BASE_URL` | `http://localhost:3002` | Where the app-server is listening |
| `POLL_INTERVAL` | `3` (s) | How often to poll for workflow status |
| `POLL_TIMEOUT` | `180` (s) | How long to wait before giving up |
| `TEST_REPO` | per-test | Override the repo a test uses |

```bash
TEST_REPO=myworkspace/myrepo POLL_TIMEOUT=300 npm run test:e2e
```

## Adding a new e2e test

1. Create `src/workflows/<name>/<name>.e2e.test.ts`
2. Import `requireServerUp`, `postJson`, `pollUntilDone` from `../../test-support/e2e`
3. Assert the durable path (enqueue → poll → SUCCESS + result invariants)

See `src/workflows/bitbucket-pr-status/bitbucket-pr-status.e2e.test.ts` as the reference shape.
