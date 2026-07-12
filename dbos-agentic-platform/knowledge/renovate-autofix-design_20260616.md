# Teaching an Agent to Babysit Renovate PRs

**Date:** 2026-06-16
**Audience:** our eng team
**Status:** spike complete → sharing what we learned + where it could go (productionization shape still open)
**First exhibit:** failing Renovate PRs in `atlassian/dt-proc` · **Stack:** DBOS v4 + Vercel AI SDK + Rovo Dev + Bitbucket Cloud

> Companion docs: the raw findings live in [`renovate-autofix-spike_20260615.md`](./renovate-autofix-spike_20260615.md);
> the workflow's run/operate guide lives in [`src/workflows/bitbucket-pr-autofix/README.md`](../src/workflows/bitbucket-pr-autofix/README.md).
> This doc is the narrative + the design decisions behind them.

---

## The shape

A lot of operational toil is the same loop wearing different clothes: **find the thing that needs attention → make a routine judgment call from logs/signals → take a bounded, known action.** Humans do this all day — reading a CI log, an alert, a failed deploy — and the judgment is real but rarely creative.

That loop has a clean shape:

```
discover  →  triage  →  act
(cheap,      (the only   (bounded,
 deterministic) LLM step)  auditable)
```

The bet we wanted to test: if you put the *judgment* in an agent and keep everything around it plain, durable code, you can absorb that toil safely. To find out, we built the most boring possible instance of the loop end-to-end — failing dependency-bump PRs — because the worst case is harmless ("we re-ran a pipeline we didn't need to") and the judgment is genuinely non-trivial.

This doc is the story of that build: what the agent turned out to be good at, the durable-orchestration plumbing underneath, the one scaling wall we hit, and where the same shape could go next.

---

## The first exhibit: failing Renovate PRs

`atlassian/dt-proc` had **95 open PRs**. Of the first 50 we pulled, **45 were Renovate** dependency bumps — 90%. Sixteen of them were sitting red. Somebody has to look at each failing bump and decide one of three boring things:

- **retrigger** — the failure was a transient blip (Artifactory 404, runner timeout); a fresh run clears it.
- **rebase** — the branch fell behind `master`; picking up recent changes fixes it.
- **flag** — it's a real, deterministic failure (breaking API, compile error) that no amount of re-running will fix; a human needs it.

That triage is pure toil, but it's *not* trivial: you have to open the pipeline, find the step that actually failed (ignoring the steps that passed), read the error, and judge whether it's transient. It's exactly the judgment-call-from-logs task an agent is good at — so we built one.

Mapped onto the loop above, it's three DBOS steps:

```
bitbucketPrAutofix(repo)
  ├─ discover        (1×)  list PRs + build statuses → keep failing non-major Renovate
  ├─ triage-{prId}   (N×)  Rovo Dev reads the pipeline logs → { decision, confidence, reason }
  └─ act-{prId}      (N×)  retrigger | rebase | flag
```

---

## Part 1 — Finding the red PRs (Bitbucket API archaeology)

There is no single "give me failing PRs" endpoint. It's two steps:

```
GET /2.0/repositories/{repo}/pullrequests?state=OPEN&pagelen=50
    → id, title, source.branch, source.commit.hash
GET /2.0/repositories/{repo}/commit/{hash}/statuses?pagelen=50
    → one build status per pipeline definition
```

That's 51 API calls for 50 PRs. Two findings shaped the code:

- **Title is a reliable filter.** Renovate PRs follow `[<risk>] [Renovate] [major|patch-or-minor] [external?] Update dependency …`. We match `[Renovate]` and skip `[major]` — high-risk majors need code changes, not automation. 12 of the 16 failures were exactly those majors, correctly out of scope.
- **A commit has *multiple* build statuses, and order is not meaningful.** The status that actually gates the PR is the one keyed `prs:*` (e.g. `prs:**:master`) — *not* `default`. Our original code took `values[0]`, which was fragile luck. We now explicitly select the `prs:`-keyed status.

```27:27:dbos-agentic-platform/src/workflows/bitbucket-pr-autofix/steps/discover.ts
    const f = statuses.find((s) => FAILED_BUILD_STATES.has(s.state) && s.key?.startsWith("prs:"));
```

### Retriggering the *right* pipeline

Bitbucket Cloud has **no "rerun" endpoint** — the only programmatic path is `POST /pipelines/` to create a fresh run. The catch is the `target` shape: firing the `default` branch pipeline (what our first cut did) runs a pipeline that *passes*, while the red `prs:**:master` one stays red forever. The PR pipeline needs a specific, under-documented target:

```jsonc
{ "target": {
    "type": "pipeline_pullrequest_target",
    "source": "<pr source branch>",
    "destination": "<pr dest branch>",
    "destination_commit": { "hash": "<dest head hash>" },
    "commit": { "hash": "<pr source head hash>" },
    "pullrequest": { "id": 2037 },        // one word "pullrequest", id as a NUMBER
    "selector": { "type": "pull-requests", "pattern": "**" }
} }
```

`pull_request:{id}` or a stringified id → HTTP 400. `pullrequest: { id: <number> }` → 201.

---

## Part 2 — The intelligence layer (Rovo Dev)

Triage is the only step that needs judgment, so it's the only step that calls an LLM. We hand Rovo Dev the PR metadata and let *it* fetch the pipeline logs (via its Bitbucket MCP tools) and reason:

> **PR #1934:** `@atlassian/image-processor@0.6.3` native binding fails with `undefined symbol: heif_init`.
> Decision: **flag**, confidence **0.93** — "Do not retrigger/rebase; hold the Renovate PR until a fixed binary is published."

That's a correct, non-hallucinated read of a real log — it found the failing step, read the actual error, and reasoned about the cause. Good enough to trust with the retrigger/flag call (with a human still in the loop for `flag`).

We enrich the prompt with everything we already know (branch, head commit, failing status key, risk tag) so Rovo Dev only has to fetch logs, not rediscover context.

### Two ways to call Rovo Dev — and why it matters

| | `acli rovodev run` (one-shot) | `acli rovodev serve` (HTTP) |
|---|---|---|
| Process | fresh per call | one long-lived server |
| Output | clean JSON via `--output-schema` | SSE stream, parse JSON out of text |
| State | **stateless, isolated** | **single shared session** (`/v2/reset` between PRs) |
| Startup | ~10s each call | paid once |
| Parallel? | **yes, naturally** | **no — one session** |

The spike measured ~800s (run) vs ~640s (serve) across 16 PRs and initially leaned `serve` for the 10s/PR saving. That recommendation flipped — see Part 4.

---

## Part 3 — The platform: DBOS as the orchestration layer

The PR bot isn't a one-off script — it shares its plumbing with the other workflows already in this repo (`scan-and-fix`, `bitbucket-pr-status`, `platform-smoke`), all of them durable and queue-driven. DBOS is the orchestration framework underneath, and it's worth a beat on *why*.

### Why DBOS

We evaluated Temporal and chose DBOS. The pitch that won: **it's just TypeScript + Postgres.**

- **No infra to run** — no orchestration server, no separate broker. Postgres is the only dependency, and it holds both our business data and DBOS's own workflow state (different tables, same DB).
- **Plain control flow** — workflows are `if`/`for`/`try-catch`, not a DSL. The autofix loop reads like normal code.
- **Durable by default** — every `DBOS.runStep` is a memoized checkpoint. Crash mid-run and it resumes from the last completed step instead of redoing work (or re-calling an LLM, or re-firing a pipeline).
- **Postgres-backed queues** — `FOR UPDATE SKIP LOCKED`, no message broker. Concurrency/rate limits are queue config.
- **Retry/fallback is config** — `{ retriesAllowed: true, maxAttempts: 2 }` on a step, not bespoke code.

### The layered architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  HTTP API            Express, one router per workflow              │
│                      POST /workflow/<name>  ·  GET /workflow/:id   │
├──────────────────────────────────────────────────────────────────┤
│  Workflows           scan-and-fix · bitbucket-pr-status ·          │
│  (orchestration)     bitbucket-pr-autofix · platform-smoke         │
│     └─ Steps         discover → triage → act   (durable units)     │
├──────────────────────────────────────────────────────────────────┤
│  Platform            config · db · dbos bootstrap · WorkflowModule │
│     └─ Integrations  Bitbucket · GitHub · Rovo Dev · LLM (AI SDK)  │
├──────────────────────────────────────────────────────────────────┤
│  DBOS SDK v4         durable workflows · steps · queues            │
├──────────────────────────────────────────────────────────────────┤
│  Postgres            business tables + DBOS system state (one DB)  │
└──────────────────────────────────────────────────────────────────┘
```

Steps never reach out to the world directly — they call the **integrations** in the platform layer (`platform/bitbucket.ts`, `platform/rovodev.ts`, …). That keeps each workflow about *orchestration* and each integration independently testable and reusable across workflows.

### Server and worker: split by the queue

DBOS lets us cleanly separate the thing that *accepts* work from the thing that *does* it. They share nothing but Postgres:

```
  client ──POST /workflow/pr-autofix {repo}──►  server  (DBOSClient, no DBOS.launch)
                                                  │  enqueue by queue NAME only —
                                                  │  imports zero workflow code
                                                  ▼
                                         ┌──────────────────┐
                                         │     Postgres     │  queue rows + workflow
                                         │  (DBOS sys + biz)│  & step state
                                         └────────┬─────────┘
                                                  │  FOR UPDATE SKIP LOCKED (dequeue)
                                                  ▼
                                            worker  (DBOS.launch + registerQueue)
                                              imports workflow modules →
                                              runWorkflow → runStep × N
                                                  │
  client ──GET /workflow/pr-autofix/:id──►  server reads workflow state ◄┘
```

- **Server** (`server.ts`) holds a `DBOSClient`, mounts each workflow's router, and enqueues by queue name. It knows the *name* of the work, never the code. That's why it can stay a container while the worker moves (Part 4).
- **Worker** (`worker.ts`) calls `DBOS.launch()`, imports the workflow modules (which registers them), and drains the queues. Workflow/step code lives **only** here.

### Adding a workflow is a plug-in, not a rewrite

Every workflow conforms to one contract — `WorkflowModule` — and registers itself in one array. The platform does the rest:

```5:11:dbos-agentic-platform/src/platform/types.ts
export interface WorkflowModule {
  name: string;         // must match the name passed to DBOS.registerWorkflow
  queueName: string;
  schemaPath?: string;  // absolute path to this workflow's schema.sql; omit if the workflow owns no table
  buildRouter: (client: DBOSClient) => Router;
  register: () => void; // called by worker before DBOS.launch() to ensure workflow is registered
}
```

```
workflows/<name>/
  index.ts      registerWorkflow(fn, { name })          ─┐
  steps/*.ts    step bodies (the runStep targets)        │ exports one
  routes.ts     Express router (enqueue + poll status)   │ WorkflowModule
  schemas.ts    typed I/O contracts                      │
  constants.ts  queue name, workflow name, limits       ─┘
        │
        ▼  appended once to
  workflows/index.ts → workflowModules[]
        ├── server: mounts buildRouter(client) + enqueues by queueName
        └── worker: calls register() before launch, then runs the steps
```

So `bitbucket-pr-autofix` sits next to `scan-and-fix`, `bitbucket-pr-status`, and `platform-smoke` with no special-casing — add a folder, append to the array, done.

### Why per-PR steps (the detail that matters)

Inside the autofix workflow, the deliberate choice is **one step per PR, not one step per phase**:

```25:32:dbos-agentic-platform/src/workflows/bitbucket-pr-autofix/index.ts
    const decision = await DBOS.runStep(() => triagePrStep(repo, pr), { name: `triage-${pr.prId}` });
    DBOS.logger.info(`[bb-autofix] PR #${pr.prId} → ${decision.decision} (conf=${decision.confidence})  ${decision.reason}`);
    triaged.push({ pr, decision });
```

If the worker crashes after triaging 3 of 4 PRs, replay re-uses those 3 decisions and does **not** re-call Rovo Dev or re-fire a pipeline. The step name carries the `prId` because DBOS keys memoization by step name — names must be unique per iteration. The memoization unit should match the thing you don't want to redo.

No business table either: the workflow's return value *is* the persisted result, served straight from DBOS workflow state by the GET endpoint.

---

## Part 4 — The scaling wall, and an open design question

The spike workflow triages PRs **sequentially**. The obvious next step is to do 5 at once — and that's where `serve` mode falls apart: it's a **single shared session**. Every triage does `/v2/reset` then `/v2/chat`, so five concurrent tasks would reset each other's context mid-flight. Serve mode can't be made parallel without running a *pool* of servers and juggling N session tokens — more moving parts to fake what one-shot exec gives for free.

So the parallel path is **exec**: spawn a fresh `acli rovodev run` per PR. Each process is isolated → natural parallelism, no session bleed, clean JSON out. DBOS would bound the fan-out:

```ts
const triageQueue = new WorkflowQueue("triage", { concurrency: 5 });
```

Exec then raises the real open question: **where does `acli` run?** We haven't locked this — it's the main thing to decide when we productionize. Three considerations frame it:

1. **`acli rovodev` is interactive-auth and host-bound.** It's logged in on the host; reproducing that auth inside a container is painful/unproven. Whatever we pick, acli realistically lives on the host.
2. **The ambition isn't just triage — it's rebase + push (and eventually code-fix).** That needs the *full* agentic toolchain: a writable workspace and git credentials, not a narrow "prompt → JSON" shim.
3. **There's no prod deploy yet.** Zero sunk cost in containerizing the worker, so we're free to choose.

### The options on the table

- **Worker on the host; server + Postgres containerized.** Simplest exec story — the worker runs where acli, git creds, and a workspace already are. Idiomatic DBOS: server and worker only meet at the Postgres queue, so co-location was never required. Cost: the worker stops being a uniform container in the compose stack.
- **Host exec shim.** Keep the worker in a container; a tiny host HTTP server spawns acli per request. Preserves the container boundary, but a narrow shim doesn't cover rebase's workspace + git needs, so it may just front host-side complexity with an extra hop.
- **Containerize acli (bake auth in).** Cleanest deploy story *if* we can make acli auth non-interactive — which we haven't proven. Worth a spike before ruling in or out.

One candidate layout (worker-on-host), to make the queue-decoupling concrete — **not a final call**:

```
                          ┌──────────────────────────── host ────────────────────────────────┐
  POST /workflow/pr-autofix│                                                                    │
  ───────────────────────► │  ┌──────────────┐   enqueue    ┌────────────┐                      │
                           │  │ app server   │ ───────────► │  Postgres  │ ◄──── DBOS queue     │
                           │  │ (container)  │              │ (container)│       state           │
                           │  └──────────────┘              └─────┬──────┘                      │
                           │                                      │ dequeue                      │
                           │                                ┌─────▼───────────────┐              │
                           │                                │ worker               │             │
                           │                                │  spawn acli rovodev  │── git push ──┼──►
                           │                                │  run  ×N concurrent  │   (rebase)   │
                           │                                └──────────────────────┘              │
                           └────────────────────────────────────────────────────────────────────┘
```

Whatever we choose, two limits to watch on parallel exec: Rovo Dev rate limits, and host CPU/memory (each invocation spins up acli + its MCP servers).

---

## Part 5 — This isn't really about Renovate

The thing worth sharing isn't the PR bot — it's the **shape** underneath it:

```
discover  →  triage (agent reasons from real signals)  →  act (deterministic API calls)
   ▲ cheap, deterministic        ▲ the only LLM step           ▲ guardrailed, auditable
```

The agent only does the judgment call; everything around it is plain, testable code, and every step is a durable DBOS checkpoint. That pattern is domain-agnostic. Swap what "discover" finds and what "act" does, and the same skeleton handles a lot of operational toil:

| Instance | discover | triage (agent) | act |
|---|---|---|---|
| **Renovate PRs** (built) | failing Renovate PRs | retrigger / rebase / flag from pipeline logs | trigger PR pipeline / rebase / flag |
| **Failing deployments** | red deploys / rollouts | transient infra blip vs real regression, from deploy + health logs | re-run deploy / roll back / page a human |
| **Alert investigations** | firing alerts (Datadog/PagerDuty) | correlate metrics + recent deploys + logs into a first-pass root cause | enrich the incident / open a Jira / escalate |
| **Flaky test triage** | repeatedly failing CI tests | flaky vs genuinely broken, from history + diff | quarantine / reopen ticket / @ owner |
| **Dependency/security** | new CVE advisories | does it actually hit our usage? | open patch PR / suppress with rationale |

The common payoff is the same in every row: **collapse the "human reads logs and makes a routine judgment" loop**, while keeping the actions deterministic, rate-limited, and fully auditable through DBOS workflow state. The wins compound — a triage agent that already knows how to read a pipeline log is most of the way to reading a deploy log or an alert.

The honest boundary: this works where the action set is small and well-defined and a wrong call is cheap or reversible (retrigger a pipeline, open a ticket). It is *not* a license to auto-merge code or auto-rollback prod without a confidence gate and a human in the loop on the irreversible stuff. Renovate PR triage was a deliberately low-stakes first target precisely because the worst case is "we re-ran a pipeline we didn't need to."

---

## Gotchas & lessons (the compressed version)

- **`values[0]` is a lie** — Bitbucket returns multiple build statuses per commit; select by `prs:` key, not position.
- **Retrigger the PR pipeline, not the branch pipeline** — `pipeline_pullrequest_target`, `pullrequest:{id:<number>}`, or you'll trigger a green pipeline and "fix" nothing.
- **Serve mode = one brain.** Great for sequential, useless for parallel. One-shot exec is stateless and parallelizes for free — at the cost of ~10s startup each.
- **Let the agent fetch its own logs.** Enriching the prompt with what we already know (branch, status key, risk) cut tool calls; making Rovo Dev pull the log itself kept us out of the log-parsing business.
- **Per-PR steps, not per-phase steps** — the memoization unit should match the thing you don't want to redo on crash (an LLM call, a pipeline trigger).
- **DBOS decouples placement** — server-in-container + worker-on-host is normal precisely because they only meet at the Postgres queue.

---

## What's next

| Item | Notes |
|---|---|
| Parallel triage | `WorkflowQueue` with bounded `concurrency`, exec `acli rovodev run` per PR (decide worker placement — see Part 4) |
| Generalize the pattern | apply discover→triage→act to deployments / alert investigations (see Part 5) |
| Real `rebase` push | needs git write creds, scoped separately from `BITBUCKET_TOKEN` |
| Confidence gate | only auto-act above a threshold; low-confidence → flag |
| Pipeline follow-up | poll each retriggered pipeline to a terminal state, record outcome |
| `flag` handoff | PR comment / Slack / Jira instead of log-only |
| Pagination | `listOpenPullRequests` fetches first 50; dt-proc has ~95 open |
| Major bumps | 12/16 failures need code changes — correctly flagged, human-review, not automation |
