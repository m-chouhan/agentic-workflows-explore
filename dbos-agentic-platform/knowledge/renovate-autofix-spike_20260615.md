# Renovate PR Autofix — Exploration Spike

**Date:** 2026-06-15  
**Scope:** `atlassian/dt-proc`  
**Goal:** Understand how to identify failing Renovate PRs, classify the failure cause, and route to the right automated action.

---

## 1. Data — what's actually failing

Pulled via the `bitbucketPrStatus` workflow (real `BITBUCKET_TOKEN`).

| Metric | Count |
|---|---|
| Open PRs | 95 (workflow fetches first 50) |
| Renovate PRs in first 50 | 45 (90%) |
| Renovate FAILED/STOPPED | **16** |
| Renovate SUCCESSFUL | 27 |

Failing 16 by Renovate risk tag:

| Tag | Count | Likely fix |
|---|---|---|
| `[high-risk] [major]` | 12 | Code change required (breaking API) |
| `[medium-risk] [patch-or-minor] [external]` | 3 | Possibly retrigger |
| `[low-risk] [patch-or-minor]` | 1 | Possibly retrigger |

**Title format is reliable:** `[<risk>] [Renovate] [major|patch-or-minor] [external?] Update dependency <name> to <ver>`  
Filter: `/\[Renovate\]/`. Risk and scope are parseable from the bracket tags.

---

## 2. Bitbucket API — how to get failing PRs

Two-step, no single endpoint:

```
Step 1: GET /2.0/repositories/{repo}/pullrequests?state=OPEN&pagelen=50
        → list of PRs; each has id, title, source.branch.name, source.commit.hash

Step 2: GET /2.0/repositories/{repo}/commit/{hash}/statuses?pagelen=50
        → array of build statuses, one per pipeline definition
```

51 API calls for 50 PRs. Already implemented in `src/platform/bitbucket.ts` as `listOpenPullRequests` + `getPrBuildStatuses`.

### Build status shape (one entry per pipeline definition)

```jsonc
{ "key": "prs:**:master",    "state": "FAILED",     "name": "Pipeline - pullrequests: **" }
{ "key": "default",          "state": "SUCCESSFUL",  "name": "Pipeline - default" }
{ "key": "custom:trust-...", "state": "SUCCESSFUL",  "name": "Pipeline - custom: ..." }
```

**Key finding:** A PR head commit has *multiple* build statuses. The status that gates the PR merge is the one keyed `prs:*` — NOT `default`. Our existing `getBuildStatus` was taking `values[0]` (order-dependent, fragile). Fixed to prefer `prs:`-keyed status.

---

## 3. Bitbucket API — how to retrigger the right pipeline

`POST /2.0/repositories/{repo}/pipelines/` — the `target` shape selects which definition runs.

| Pipeline | `target.type` | Extra fields |
|---|---|---|
| default (branch) | `pipeline_ref_target` | `ref_type: "branch"`, `ref_name` |
| custom | `pipeline_ref_target` | + `selector: { type: "custom", pattern }` |
| **pull-requests** | `pipeline_pullrequest_target` | see below |

### Trigger the PR pipeline (the red check)

Verified → HTTP 201. Undocumented in OpenAPI spec but works:

```jsonc
{ "target": {
    "type": "pipeline_pullrequest_target",
    "source": "<pr source branch>",
    "destination": "<pr dest branch>",
    "destination_commit": { "hash": "<dest head hash>" },
    "commit": { "hash": "<pr source head hash>" },
    "pullrequest": { "id": 2037 },    // ⚠ "pullrequest" one word, id as NUMBER
    "selector": { "type": "pull-requests", "pattern": "**" }
} }
```

**Gotcha:** `pull_request:{id}` or `id` as string → 400. Must be `pullrequest: { id: <number> }`.

### No "rerun" endpoint

Bitbucket Cloud has no API to rerun an existing pipeline or its failed steps. The only programmatic path is `POST /pipelines/` to create a new run. This IS the retrigger.

### Bug in current autofix

`triggerPipelineForBranch` fires the `default` (branch) pipeline — which passes — not the `prs:**:master` pipeline that is actually red. The PR stays FAILED regardless of how many branch pipelines we trigger.

---

## 4. Rovo Dev — the intelligence layer

For each failing PR, we need to decide: **retrigger**, **rebase**, or **flag** (beyond automated fix).

### Integration option A — `acli rovodev run` (one-shot per PR)

```bash
acli rovodev run --disable-permission-checks \
  --output-schema '{"type":"object","properties":{"decision":{"type":"string","enum":["retrigger","rebase","flag"]},"confidence":{"type":"number"},"reason":{"type":"string"},"action_hint":{"type":"string"}},"required":["decision","confidence","reason","action_hint"]}' \
  "<enriched PR prompt>"
```

- Returns clean JSON on stdout (enforced by `--output-schema`).
- Rovo Dev fetches Bitbucket pipeline logs itself via MCP tools.
- ~50-60s per PR (startup + MCP calls + LLM reasoning).
- Stateless — each call is independent.
- No persistent process needed.

### Integration option B — `acli rovodev serve 4000` (persistent HTTP server)

```bash
acli rovodev serve 4000
# → POST /v2/reset    (clear session between PRs)
# → POST /v2/chat     (send prompt, returns SSE stream of part_delta events)
```

```bash
# Send prompt
curl -X POST http://localhost:4000/v2/chat \
  -H "Authorization: Bearer <session-token>" \
  -H "Content-Type: application/json" \
  -d '{"message": "<enriched PR prompt>"}'
# → SSE stream: event: part_delta / data: {"delta": {"content_delta": "..."}}
# Reassemble content_delta values → extract JSON from response text
```

- Pay startup cost once; all 24 MCP servers stay warm.
- No `--output-schema` flag in serve mode — must extract JSON from streamed text (regex on `\{[^{}]+\}`).
- Accessible at `host.docker.internal:4000` from the DBOS worker container.
- Needs `POST /v2/reset` between PRs to clear session context.
- **16 PRs → ~800s with option A vs ~640s with option B** (saves ~10s startup per PR).

### Rovo Dev accuracy (tested on PR #1934)

Rovo Dev fetches the actual pipeline log, identifies the failing step, reads the error, and reasons about the cause — not hallucination:

> PR #1934: `@atlassian/image-processor@0.6.3` native binding fails with `undefined symbol: heif_init`.  
> Decision: **`flag`**, confidence: **0.93**  
> Action hint: Do not retrigger/rebase — flag to maintainers, hold Renovate PR until a fixed binary is published.

Consistent across both option A and option B.

---

## 5. Orchestration design

### Proposed flow

```
bitbucketPrAutofix(repo)
  ├─ step: find-failing-renovate-prs
  │    GET /pullrequests + GET /commit/{hash}/statuses per PR
  │    filter: [Renovate] in title + prs: status is FAILED/STOPPED
  │    pick first (or batch N)
  │
  ├─ step: triage-{prId}   (calls Rovo Dev)
  │    POST /v2/reset  (serve mode) OR  acli rovodev run (one-shot)
  │    POST /v2/chat with enriched prompt: PR metadata + ask for pipeline log analysis
  │    returns: { decision, confidence, reason, action_hint }
  │
  └─ step: act-{prId}
       decision=retrigger  → POST /pipelines/ with pipeline_pullrequest_target
       decision=rebase     → (stub — future: git rebase + push)
       decision=flag       → (stub — future: PR comment / Slack / Jira)
```

### Prompt enrichment (reduces Rovo Dev tool calls and latency)

Pass what we already know, so Rovo Dev only needs to fetch logs:

```
PR #<id> in <repo>
Title: <title>
Branch: <sourceBranch> → <destBranch>
Head commit: <hash>
Failing status key: <prs:...>
Renovate risk tag: <low|medium|high>-risk, <major|patch-or-minor>

Fetch pipeline logs for the most recent failed <key> pipeline on this branch.
Decide: retrigger / rebase / flag.
Return JSON: { decision, confidence, reason, action_hint }
```

### Option A vs B — recommendation

**Use option A (`rovodev run`) first.** It is simpler — no persistent process to manage, no SSE parsing, no session token rotation. The DBOS `DBOS.runStep` wraps it as a shell exec. Serve mode adds complexity for ~10s/PR savings. Revisit option B if latency becomes a real problem at scale.

---

## 6. Known gaps and next steps

| Gap | Notes |
|---|---|
| Retrigger targets wrong pipeline | Need `pipeline_pullrequest_target` (above) not `triggerPipelineForBranch` |
| Rebase path | Stub — needs git write access; separate credential scope from `BITBUCKET_TOKEN` |
| Flag handoff | Stub — PR comment or Slack; TBD |
| Pagelen=50 misses PRs | `atlassian/dt-proc` has 95 open PRs; need to follow `next` pagination |
| Major bumps | 12 of 16 failures need code changes; Rovo Dev will `flag` these correctly, but the action is human-review, not automation |
| `acli rovodev` availability in Docker | `rovodev run` requires the CLI on the worker host (not inside the container). Use `host.docker.internal:4000` (serve mode) if the worker runs in Docker |
