# Testing Strategy — dbos-agentic-platform

## Stack: Jest + Supertest

One toolchain, driven by `jest`:

- **Jest** (v29+) — test runner + mocking (`jest.fn`/`jest.mock`). Atlassian `ADOPT` default; resolves from Artifactory.
- **@swc/jest** — fast TS transform (no `ts-jest`, ESM-friendly).
- **Supertest** — in-process HTTP assertions (mount the Express app, no running server).
- **`jest.mock`** — mock boundaries only (external APIs, DBOSClient).
- **docker-compose Postgres** — real DB for e2e. No Testcontainers (redundant with `run-local.sh`).

### Why Jest (not Vitest) — recorded decision
- Atlassian Node.js Tech Stack Standard: **Jest v29+ = ADOPT**, **Vitest = ASSESS** (STACK-145 pending).
- Vitest's latest versions are quarantined by Artifactory Xray; Jest resolves cleanly.
- Vitest is the likely future default for ESM-heavy codebases (Trello/Loom moved to it). Revisit when STACK-145 lands.
- This project is CommonJS today → Jest is the path of least resistance.

### Migration to Vitest later — low effort (~1–2h, mostly find/replace)
Write tests now in **Vitest-compatible style** so migration is a sed script:
1. Import APIs explicitly: `import { describe, it, expect, jest } from "@jest/globals"` (no ambient globals).
2. Use ESM `import`, never `require`, in test files.
3. Keep `jest.mock` factories self-contained (Vitest's `vi.mock` is hoisted — the one real gotcha).
4. Avoid Jest-only APIs (legacy timers, exotic `requireActual`).

Migration = `jest.`→`vi.`, `@jest/globals`→`vitest`, swap config. See [Vitest migration guide](https://vitest.dev/guide/migration.html#migrating-from-jest). Cost scales with test count → migration-friendly from day one keeps it near-zero.

## Three tiers (one runner, Jest `projects`, separated by filename)

| Tier | File glob | What's mocked | DB | Speed |
|---|---|---|---|---|
| Unit | `**/*.unit.test.ts` | DBOS itself (`@dbos-inc/dbos-sdk`) | none | <1s |
| Integration | `**/*.int.test.ts` | `DBOSClient` + `db.ts` | none | 1–3s |
| E2E | `**/*.e2e.test.ts` | external APIs (real stack, black-box) | **real** (docker-compose) | <5s |

## E2E = one shallow platform smoke, not per-feature coverage

E2E proves the **durable path is wired** (enqueue → queue → worker → step → Postgres → poll),
not that any single workflow's business logic is correct. There is exactly **one** e2e canary:
the `platformSmoke` workflow, which pulls one PR (any state) and writes one row.

- Feature invariants (PR counts, build-state mapping, autofix outcomes) belong in **int/unit**.
- Workflows with real side effects (e.g. `bitbucket-pr-autofix` triggers live pipelines) are
  **never** e2e-tested — that would mutate external state on every test run. Cover them at int/unit.
- Keep the smoke cheap and deterministic so it stays fast and rarely flakes.

## Golden rule: never mock Postgres

DBOS's durability **is** Postgres — the queue (`FOR UPDATE SKIP LOCKED`), `workflow_status`, `operation_outputs`, step memoization all live in PG tables. Mocking Postgres = not testing DBOS.

Mock the **boundaries** (HTTP-in via Supertest, third-party-APIs-out via `jest.mock`); keep **Postgres real** wherever DBOS is actually exercised (e2e tier).

## Scripts

```json
"test":       "jest --selectProjects unit int",
"test:watch": "jest --selectProjects unit --watch",
"test:e2e":   "jest --selectProjects e2e",
"test:all":   "jest"
```

`test` (no infra) runs in CI on every push. `test:e2e` runs after `stack:up`.

## CI / deploy targets (Atlassian-native, when wired)
- **Bitbucket Pipelines** — emit **JUnit XML** (`jest-junit`) for test reporting.
- **Pollinator** — post-deploy synthetic check (replaces `smoke.sh`).

## Layout — all tiers co-located with their workflow

Every test sits next to the code it covers; nothing lives in a separate top-level `tests/` tree.

```
src/workflows/platform-smoke/
  platform-smoke.e2e.test.ts # the one e2e canary (durable path, real stack)
src/workflows/<name>/
  routes.int.test.ts         # integration (Supertest + mocked client)
  steps/<step>.unit.test.ts  # unit (pure logic, added later)
src/test-support/e2e.ts      # shared e2e HTTP helpers (excluded from build)
```

E2E suites replaced the old `scripts/e2e/*.sh`. The enqueue → poll → assert-SUCCESS protocol
lives once in `src/test-support/e2e.ts` (`runWorkflow(path, payload)`).

Coverage today: the `platformSmoke` e2e canary + `bitbucket-pr-status` route int tests.
Unit tests are deferred while the platform is still being scaffolded — `jest.passWithNoTests`
keeps the empty unit tier green. Add per-workflow int/unit suites as use-cases firm up.

`src/test-support/` and all `*.test.ts` are excluded from the build (`tsconfig.json`); they are
type-checked separately via `tsconfig.test.json`.

## Install (run from an Artifactory-authenticated terminal)

```bash
npm i -D jest @types/jest @swc/jest @swc/core supertest @types/supertest jest-junit
```

> Personal project → public npm locally is fine. Any Micros/Pipelines service → must go through Artifactory.

## Docs

- Jest: [getting started](https://jestjs.io/docs/getting-started) · [projects config](https://jestjs.io/docs/configuration#projects-arraystring--projectconfig) · [mock functions](https://jestjs.io/docs/mock-functions)
- Supertest: [README](https://github.com/ladjs/supertest)
- DBOS testing: [tutorial](https://docs.dbos.dev/typescript/tutorials/development/testing) · skill `references/test-setup.md`
- [goldbergyoni/nodejs-testing-best-practices](https://github.com/goldbergyoni/nodejs-testing-best-practices)
