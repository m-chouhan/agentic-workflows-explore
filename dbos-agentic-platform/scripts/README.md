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

Black-box HTTP tests that drive a real workflow through the full stack
(server → queue → worker → DB → poll endpoint).

| Command | Workflow |
|---|---|
| `npm run e2e:bitbucket` | `bitbucketPrStatus` — enqueue, poll, validate result shape |
| `npm run e2e:scan` | `scanAndFix` — pulls a real GitHub repo + runs Trivy (slower; needs `GOOGLE_GENERATIVE_AI_API_KEY`) |

Each test exits non-zero on first failed assertion. Run them individually for now —
chain in CI with `&&` if needed.

### Env overrides

| Var | Default | Purpose |
|---|---|---|
| `BASE_URL` | `http://localhost:3002` | Where the app-server is listening |
| `POLL_INTERVAL` | `3` (s) | How often to poll for workflow status |
| `POLL_TIMEOUT` | `120` (s) | How long to wait before giving up |
| `TEST_REPO` | per-script | Override the repo a test uses |

Example:
```bash
TEST_REPO=myworkspace/myrepo POLL_TIMEOUT=300 npm run e2e:bitbucket
```

## Adding a new e2e test

1. Create `scripts/e2e/test-<workflow-name>.sh`
2. Source `_lib.sh` for `require_server_up`, `wait_for_workflow`, `assert_jq`
3. Add an npm alias in `package.json` under `scripts`

See `test-bitbucket-pr-status.sh` as the reference shape (6 phases: validation × 2,
not-found, enqueue, poll-until-done, result-shape).
