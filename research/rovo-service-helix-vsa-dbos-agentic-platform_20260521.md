# Rovo Service / Helix / VSA: Lessons for a DBOS Agentic Platform
**Research Date:** 2026-05-21  
**Session:** Rovo Dev Research Skill  
**Scope:** 13 internal Atlassian Confluence pages (VPORT space + agents space, 2025–2026)  
**Applicability:** DBOS + Vercel AI SDK personal agentic platform, early skeleton stage, targeting multi-agent orchestration

---

## Executive Summary

Atlassian's Rovo Service team built an agentic platform that autonomously deflects ~30% of IT Service Desk L1 tickets in 4 months — going from zero to production with no single "launch moment." The system is built on a **Supervisor + Task Agent (Minion)** pattern where a reasoning-heavy supervisor orchestrates specialized domain agents, and critically, **the orchestration layer is deterministic while the reasoning steps are probabilistic**. This is the exact same quantum/Newtonian duality you're targeting with DBOS. The team's biggest hard-won lessons are: (1) plan validation before execution is non-negotiable, (2) a single canonical context object across all pipeline stages prevents silent failures, (3) oscillation in LLM-generated plans must be explicitly capped, and (4) evaluation discipline — not launch quality — is what enables fast iteration. For your DBOS platform at early skeleton stage, this maps to: build the supervisor orchestration layer deterministically in DBOS workflows, isolate LLM calls to reasoning-only steps wrapped in typed output + validation, and instrument early even if imperfect.

**Key Numbers:**
- 4 months: zero → 30% L1 ticket deflection
- 60% → 86% execution success (Q4 roadmap target)
- 26% of cases abandoned (integration errors, bad plans, wrong runbooks)
- 58.6% → 1.0% oscillation (fixed by capping retry loops)
- 82.7% deflection detection rate at latest evaluation run

---

## Theme 1: The Supervisor + Minion Pattern — A Proven Architecture

The Rovo Service architecture is built around one central insight: **the supervisor is an orchestrator and evaluator, not an executor**. It delegates all execution to specialized Task Agents (called "Minions" internally), each owning their domain end-to-end.

```
┌─────────────────────────────────────────────────┐
│                SUPERVISOR AGENT                  │
│  • Reason (domain, complexity, current state)   │
│  • Plan (step-by-step + agent selection)        │
│  • Orchestrate (A2A comms, looping, retrace)    │
│  • Evaluate (pick best response, rollback)      │
└──────────┬──────────────────────────────────────┘
           │ delegates to
    ┌──────┴──────────────────────────────────┐
    │         TASK AGENTS (Minions)            │
    │  ┌─────────┐ ┌────────┐ ┌────────────┐  │
    │  │ Search  │ │Planner │ │ Okta/Slack │  │
    │  │ Minion  │ │ Minion │ │ Tool Agent │  │
    │  └─────────┘ └────────┘ └────────────┘  │
    └─────────────────────────────────────────┘
```

**Critical design principle:** "If a task agent needs to take a series of actions to complete its task, then this execution should be **fully handled by the task agent**, and not the Supervisor agent." The supervisor hands off context + intent; the minion owns the entire internal workflow; the minion returns structured output; the supervisor evaluates and decides next steps.

**Agent selection is deterministic-first:** The supervisor uses a two-layer selection mechanism:
1. **Context Understanding Layer** (deterministic): invocation surface + admin configuration decides the agent
2. **Query Understanding Layer** (probabilistic/LLM): only used if layer 1 is ambiguous

This prevents the supervisor from using expensive LLM reasoning for routing decisions that can be resolved by config.

**Relevance to your DBOS platform:**
- Your DBOS supervisor workflow is the exact right primitive for this pattern
- `DBOS.startWorkflow()` to spawn sub-agent workflows maps directly to supervisor → minion delegation
- Sub-agent (minion) workflows are self-contained DBOS workflows — they own their retry logic, tool calls, and state
- Deterministic routing (config/context first) before probabilistic routing (LLM) saves tokens and increases reliability

---

## Theme 2: The Pipeline — Retrieval → Planning → Execution → Verification → Evaluation

The pipeline is **not** a single LLM call. It's a five-stage deterministic pipeline where LLM reasoning is isolated to specific steps:

```
┌──────────────┐   ┌────────────┐   ┌──────────────┐   ┌───────────────┐   ┌────────────┐
│  RETRIEVAL   │ → │  PLANNING  │ → │  EXECUTION   │ → │ VERIFICATION  │ → │ EVALUATION │
│              │   │            │   │              │   │               │   │            │
│ Fetch        │   │ Aggregate  │   │ Run plan     │   │ Did it work?  │   │ Did we     │
│ runbooks     │   │ runbooks   │   │ steps via    │   │ Check result  │   │ truly      │
│ from search  │   │ → Generate │   │ task agents  │   │ vs intent     │   │ deflect?   │
│              │   │   plan DAG │   │              │   │               │   │            │
│              │   │ → Validate │   │              │   │               │   │            │
│              │   │   plan     │   │              │   │               │   │            │
└──────────────┘   └────────────┘   └──────────────┘   └───────────────┘   └────────────┘
      LLM ✓             LLM ✓           Deterministic        LLM ✓               LLM ✓
   (retrieval)      (plan gen)         (task agents)      (judge)            (eval judge)
```

**The biggest lesson:** Each stage needs a **Canonical Context Object** — a single typed data structure passed through all stages. Without it, each stage re-derives its own understanding of the ticket, leading to semantic drift, hallucination risk, and "split-brain reasoning" (planner and orchestrator disagreeing about what the ticket means). This was Atlassian's April 2026 diagnosis after 4+ months in production.

**Relevance to your DBOS platform:**
- Model each pipeline stage as a DBOS step with typed input/output
- Pass a single `TaskContext` object through all steps (never reconstruct from memory)
- In DBOS: use step names that encode stage + iteration (`{ name: "plan-generate-attempt-1" }`)
- Verification and evaluation are separate workflow steps — don't conflate "ran successfully" with "actually resolved"

---

## Theme 3: Plan Validation — The Single Highest-ROI Investment

The main achievement page explicitly calls out plan DAG validation as the turning point: execution error rates dropped materially after adding it. The design document (Page 6) reveals a two-phase approach:

### Phase 1: Deterministic Validation (always runs, fast)
```
Checks:
  ✓ No self-loops (step routing to itself)
  ✓ No dead-end paths (branch with no terminal state)
  ✓ All referenced task agents exist in registry
  ✓ All step IDs referenced in branches are defined
  ✓ No invalid field assignments
  ✓ Schema conformance (JSON structure)
```

### Phase 2: LLM-Based Validation (semantic, feature-flagged)
```
Checks:
  ✓ Does plan match runbook intent?
  ✓ Are agent selections appropriate?
  ✓ Does plan cover all required resolution steps?
  ✓ Are branching conditions semantically coherent?
```

### Rollout Strategy: Fail-Open → Fail-Closed
- **Start fail-open**: plans always execute; validation errors are logged only
- **Graduate to fail-closed** per check, once precision is proven
- This lets you build confidence in the validator without blocking all execution

**The plan schema itself is a typed JSON DAG:**
```json
{
  "steps": [
    {
      "id": "step-1",
      "taskAgent": "OktaAgent",
      "execution": { "action": "RESET_PASSWORD", "params": {...} },
      "branches": [
        { "condition": "result == 'success'", "next": "step-close" },
        { "condition": "result == 'failure'", "next": "step-handoff" }
      ]
    },
    {
      "id": "step-handoff",
      "taskAgent": null,
      "execution": { "action": "ESCALATE_TO_HUMAN" }
    }
  ]
}
```

**Relevance to your DBOS platform:**
- Before executing any agent plan, run a deterministic validator as a DBOS step
- Use Zod (you already use it with Vercel AI SDK's `generateObject`) to enforce plan schema
- Build the validator as a pure function — easy to unit test, no LLM dependency
- Start fail-open: log validation errors but execute anyway; tighten later
- Human handoff is a first-class plan node (`taskAgent: null`) — not an afterthought

---

## Theme 4: Oscillation — The Silent Killer of Agentic Loops

This is the most operationally painful lesson from Rovo Service, documented across 22 evaluation runs:

**What is oscillation?** When the planner LLM generates different plans on repeated invocations for the same ticket. Plan A → critique → Plan B → critique → Plan A (cycling). This makes the system appear to "work" but produces inconsistent outcomes and wastes tokens.

**Their numbers:**
- Oscillation at **58.6%** across Runs 16-18 (majority of complex tickets were oscillating)
- After implementing oscillation cap: **5.1%** (Run 21) → **1.0%** (Run 22)
- Run 22 became "best result since Run 11 (baseline)"

**The fix: Accept-with-warnings cap**
- After N critique-refine cycles (2-3), if plan keeps changing → accept current best plan with a warning flag
- Log which tickets are oscillating (signal for runbook improvement, not just prompt tuning)
- Oscillation is often caused by **retrieval non-determinism** (different runbook retrieved each time), not just prompt issues

**Relevance to your DBOS platform:**
- In DBOS: your step naming `{ name: "plan-attempt-1" }` already supports tracking iterations
- Implement a max retry count at the supervisor level: if plan validation fails N times → escalate
- Track oscillation as a first-class metric (separate from execution failure rate)
- Oscillating tickets reveal gaps in your task/tool definitions — fix the tools, not just the prompts

---

## Theme 5: The Hybrid Architecture — Quantum + Newtonian in Practice

This is the most directly relevant philosophical finding for your platform. Atlassian explicitly evaluated and rejected pure LLM agent loops (Approach 1) in favor of the hybrid (Approach 2):

### Why Pure LLM Loops Fail at Scale
| Problem | Real-World Impact |
|---------|------------------|
| Non-determinism | 1-in-100 hallucinations that cause hard-to-debug failures |
| High latency | 15-30 seconds per step (LLM processes full context each time) |
| Runaway costs | Paying tokens for `if status == Open: do X` routing logic |
| No auditability | "Updated by AI Agent" — zero debuggability |
| No graceful degradation | LLM fails mid-thought → entire process crashes |

### The Winning Hybrid Pattern
```
DETERMINISTIC (Newtonian):            PROBABILISTIC (Quantum):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Workflow DAG (DBOS workflows)    •  Plan generation (LLM → JSON)
• Step sequencing & routing        •  Triage / domain classification
• Error handling & retry logic     •  Runbook interpretation
• State persistence                •  Quality evaluation (LLM-as-judge)
• Tool invocation (API calls)      •  Clarifying question generation
• Escalation conditions            •  Confidence scoring
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**The key quote:** "Agents doing inference & reasoning; Automations/BPL do the routing, state management and execution."

In DBOS terms: your DBOS workflow IS the BPL/automation. It's the deterministic backbone. LLM calls (`DBOS.runStep()` wrapping `generateObject()`) are the inference callouts. The workflow guarantees sequencing, retry, and state; the LLM provides reasoning.

---

## Theme 6: Evaluation Without Massive Human Labeling

Rovo Service achieved fast iteration (weekly releases) through an evaluation discipline that doesn't require huge human annotation budgets:

### Three-Pillar Evaluation Framework
1. **Golden Queries / Fixed Test Set** (~2,337 tickets): Human-validated deterministic tests run every week. Catches regressions without human review per run.

2. **LLM-as-Judge with Category-Specific Evaluators**: Different evaluators for:
   - Plan accuracy (does plan match what a human would do?)
   - Deflection detection (did system correctly identify deflectable ticket?)
   - Search quality (right runbook retrieved?)
   - Execution validation (did steps succeed?)
   - Consistency (same ticket → same plan across runs?)

3. **Versioned Prompt Templates**: Evaluator prompts stored as versioned artifacts. Enables A/B testing of evaluators themselves, rollback if an evaluator regresses.

### Key Metrics Tracked
| Metric | Latest Value | Meaning |
|--------|-------------|---------|
| Deflection Detection Rate | 92.59% | System correctly identified deflectable tickets |
| Deflection Accuracy | 81% | Of detected, correct resolution |
| Plan Accuracy | 62.55% | Plans match human expert expectation |
| Execution Success | 60% → 86% target | Steps completed without error |
| Live Deflection Rate | ~30% | % of all L1 tickets autonomously resolved |
| Oscillation Rate | 1.0% (Run 22) | Plan stability across iterations |

### The Weekly Cadence
- Monday: run full eval against fixed test set
- Analyze regressions + root causes
- Ship fixes mid-week
- Repeat

**Relevance to your DBOS platform:**
- Define 10-20 "golden workflows" for your most common tasks (email triage, code review, PR creation)
- Build a separate DBOS eval workflow that runs golden tests on a schedule
- Use `generateObject` with a judge prompt to evaluate outputs — no human annotation needed to start
- Track: task completion rate, output quality score, oscillation count, tool error rate

---

## Theme 7: Autonomy Boundaries & Human Handoff — Escalation as a Feature

Rovo Service treats escalation as a first-class success metric, not a failure. The autonomous mode design has explicit, predictable boundaries:

### Autonomy Tiers
```
┌─────────────────────────────────────────────────────┐
│  TIER 1: Fully Autonomous                            │
│  High confidence + known pattern + simple tools      │
│  → Execute end-to-end, close ticket automatically   │
├─────────────────────────────────────────────────────┤
│  TIER 2: Shadow Mode (human reviews)                │
│  Medium confidence / new ticket type                │
│  → Execute but flag for human review before close   │
├─────────────────────────────────────────────────────┤
│  TIER 3: Clarification Needed                       │
│  Missing information / ambiguous ticket             │
│  → Ask one clarifying question, then proceed        │
├─────────────────────────────────────────────────────┤
│  TIER 4: Escalate                                   │
│  Low confidence / policy decision / complex         │
│  → Pass to human with full context + reasoning      │
└─────────────────────────────────────────────────────┘
```

### What Rovo Passes on Handoff
When escalating to a human agent:
1. What was attempted (steps run, results)
2. Why escalation was triggered (low confidence, error, policy)
3. Link to relevant runbook
4. Suggested next steps for human

**Relevance to your DBOS platform:**
- Implement autonomy tiers as a config parameter: `automationLevel: "shadow" | "autonomous"`
- On escalation: always pass full `TaskContext` — don't make the human re-read the original request
- "Escalation is not failure" — track escalation rate separately from error rate
- Shadow mode is the right starting point for any new agent type

---

## Theme 8: Operational Patterns — What They Learned the Hard Way

These are the specific operational learnings from running in production for 4+ months:

### 1. Integration Errors are the #1 Abandon Cause (26% of failures)
429 rate limiting, API timeouts, and integration service errors are the dominant failure mode. Not LLM quality.

**Fix pattern:** Hard timeout per tool call (3-5 min cap); retry with backoff; on persistent failure → escalate, don't loop.

### 2. Retrieval Non-Determinism Causes Plan Regression (not just prompt issues)
"23 of 25 regressed tickets got a different Confluence runbook in Run 18 vs Run 17. The prompt/code changes themselves are directionally correct."

**Fix pattern:** Cache runbooks; rerank deterministically; pin runbook version for a ticket once retrieved.

### 3. Generic Routing is an Anti-Pattern
Runbooks that say "route to L1 support" without a concrete team name cause hallucinations in the planner (invents team names not in schema).

**Fix pattern:** Schema-constrain agent outputs; validate all referenced resources exist before accepting a plan.

### 4. Parallel Tool Calls Cause Ordering Issues
Disabled parallel tool calls in orchestrator — sequential execution is more predictable and debuggable.

**Fix pattern:** Sequential tool calls unless you have explicit parallelism requirements and output independence guarantees.

### 5. Feature Flags on Every Evaluation Change
Every new eval/validation change is gated behind a feature flag. Enables safe A/B comparison and rollback.

**Fix pattern:** In DBOS: use environment variables (`process.env.FEATURE_X`) to gate new agent behaviors.

---

## DBOS Platform Architecture Recommendations

Based on all 13 pages, here is the concrete architecture blueprint for your platform:

```
┌──────────────────────────────────────────────────────────────────┐
│                    YOUR DBOS AGENTIC PLATFORM                     │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  SUPERVISOR WORKFLOW  (DBOS.registerWorkflow)               │  │
│  │                                                             │  │
│  │  1. Classify task (deterministic: config / LLM fallback)   │  │
│  │  2. Check eligibility (can this be automated?)             │  │
│  │  3. Retrieve context (tools, templates, relevant data)     │  │
│  │  4. Generate plan (LLM → typed JSON via generateObject)    │  │
│  │  5. Validate plan (Zod schema + deterministic checks)      │  │
│  │  6. Execute plan (spawn sub-agent workflows)               │  │
│  │  7. Verify results (LLM judge step)                        │  │
│  │  8. Evaluate (log metrics, update golden test results)     │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                           │                                        │
│              ┌────────────┴────────────┐                          │
│              ▼                         ▼                           │
│  ┌─────────────────────┐  ┌─────────────────────────┐             │
│  │  SUB-AGENT WORKFLOW │  │   SUB-AGENT WORKFLOW    │             │
│  │  (e.g. email triage)│  │  (e.g. PR creation)     │             │
│  │                     │  │                          │             │
│  │  DBOS.runStep() ×N  │  │  DBOS.runStep() ×N      │             │
│  │  Tool calls         │  │  Tool calls              │             │
│  │  Own retry logic    │  │  Own retry logic         │             │
│  │  Typed output       │  │  Typed output            │             │
│  └─────────────────────┘  └─────────────────────────┘             │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  CANONICAL TASK CONTEXT (TypeScript interface)              │  │
│  │  { taskId, taskType, description, userContext,              │  │
│  │    availableAgents, metadata, attempt, escalationReason }   │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  PLAN VALIDATOR (pure function, no LLM)                     │  │
│  │  Zod schema check → agent registry check → DAG acyclic?    │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  EVAL WORKFLOW (scheduled DBOS workflow)                    │  │
│  │  Golden tasks → run pipeline → LLM judge → log metrics      │  │
│  └─────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### Implementation Sequence (Recommended Order)

**Week 1-2: Foundation**
- [ ] Define `TaskContext` TypeScript interface (canonical context)
- [ ] Build supervisor DBOS workflow skeleton (classify → plan → execute → verify)
- [ ] Implement `PlanValidator` as a pure function with Zod schema enforcement
- [ ] Define first sub-agent contract (input/output interface)

**Week 3-4: First Real Agent**
- [ ] Pick simplest daily task (e.g., email triage or PR review)
- [ ] Build it as a self-contained sub-agent workflow
- [ ] Supervisor spawns it, evaluates output, logs result
- [ ] Add fail-open validation (log errors, don't block)

**Week 5-6: Evaluation Infrastructure**
- [ ] Define 10 golden tasks (manual expected outputs)
- [ ] Build eval DBOS workflow (run golden tasks weekly)
- [ ] LLM-as-judge step for output quality scoring
- [ ] Track: completion rate, quality score, oscillation count

**Week 7+: Scale to Multi-Agent**
- [ ] Add second sub-agent type
- [ ] Supervisor routes deterministically (config first) then LLM
- [ ] Add autonomy tiers (`automationLevel` config)
- [ ] Shadow mode before autonomous mode for each new agent

---

## What's Different in Your Context vs Rovo Service

| Rovo Service | Your DBOS Platform |
|---|---|
| Handles ITSD tickets (fixed domain) | Handles varied daily tasks (open domain) |
| Runbooks as knowledge source | Task templates / tool descriptions |
| JSM as state store | DBOS system DB as state store |
| Jira Automation for workflow routing | DBOS workflows for routing |
| ~2,000 eval test cases | Start with 10-20 golden tasks |
| 10+ engineers | Solo / small team |
| Slack/Calendar/Okta tools | GitHub, email, Jira, calendar tools |
| Fixed ticket queue as input | Ad-hoc requests as input |

**Key adaptation:** Rovo Service has the luxury of a bounded domain (IT tickets). Your platform is more open-ended — this makes task classification more important upfront. Build the supervisor's classification step to be conservative: if task type is unknown → ask for clarification rather than guess.

---

## Quick-Read Summary (5 bullets)

1. **Supervisor + Minion pattern works at scale.** Single reasoning supervisor + specialized task agents. Supervisor orchestrates, minions execute. Never have the supervisor execute tasks directly.

2. **Validate plans before executing them.** Deterministic schema validation (Zod) catches 80% of issues before any LLM execution. Add semantic validation (LLM judge) later, feature-flagged.

3. **Cap oscillation explicitly.** LLM plans naturally oscillate under critique loops. After 2-3 retries: accept best plan with a warning. Oscillation is a signal about bad tool definitions, not just bad prompts.

4. **Pass a single canonical context through all stages.** Each pipeline stage reading from shared typed state (not reconstructing from LLM memory) eliminates an entire class of hallucination and drift bugs.

5. **Evaluation discipline = iteration speed.** A small fixed golden test set + LLM-as-judge lets you ship weekly with confidence. Don't wait for perfect eval infrastructure — start with 10 hand-curated examples.

---

## References

| # | Document | URL |
|---|---------|-----|
| 1 | Rovo Service: 0 to 30% Deflection | https://hello.atlassian.net/wiki/spaces/VPORT/pages/7010169984 |
| 2 | Supervisor Agent HLD | https://hello.atlassian.net/wiki/spaces/VPORT/pages/5442562478 |
| 3 | HLD Planner | https://hello.atlassian.net/wiki/spaces/VPORT/pages/5767347530 |
| 4 | Planner Orchestrator Pipeline Gap Analysis | https://hello.atlassian.net/wiki/spaces/VPORT/pages/6807359582 |
| 5 | Plan Quality Gate — Phase 2 | https://hello.atlassian.net/wiki/spaces/VPORT/pages/6679749745 |
| 6 | Execution Plan Validation — Design | https://hello.atlassian.net/wiki/spaces/VPORT/pages/6296914291 |
| 7 | Enabling Autonomous Mode — Workflow & Handoff Design | https://hello.atlassian.net/wiki/spaces/VPORT/pages/7040024988 |
| 8 | Solution Design — Supervisor Agent | https://hello.atlassian.net/wiki/spaces/VPORT/pages/5798739531 |
| 9 | Supervisor Agent <> HR Onboarding Task Agents | https://hello.atlassian.net/wiki/spaces/VPORT/pages/5969615431 |
| 10 | Leveraging LLMs for Deterministic Jira Workflows | https://hello.atlassian.net/wiki/spaces/agents/pages/6782291525 |
| 11 | Planner Schema for Employee Service Agent | https://hello.atlassian.net/wiki/spaces/VPORT/pages/6159061612 |
| 12 | Q4 Plan Execution Roadmap | https://hello.atlassian.net/wiki/spaces/~121596690/pages/6765910529 |
| 13 | [HLD] Employee Onboarding Agent | https://hello.atlassian.net/wiki/spaces/VPORT/pages/5829002081 |

**Raw docs saved to:** `research/rovo-service-helix-vsa-itsm-agentic-platform-2026-05-21.md`
