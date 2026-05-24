# Rovo Service / Helix / VSA / ITSM Agentic Platform Research
**Date:** 2026-05-21  
**Source:** hello.atlassian.net — VPORT space + agents space  
**Goal:** Learn from Atlassian's internal agentic platform build; apply to DBOS-based personal agentic platform

---

## Pages Collected (12 total)

| # | Title | Page ID | URL | Date |
|---|-------|---------|-----|------|
| 1 | Rovo Service: From 0 to Autonomously Deflecting ~30% of ITSD Tickets in 4 Months | 7010169984 | https://hello.atlassian.net/wiki/spaces/VPORT/pages/7010169984 | 2026-05-11 |
| 2 | Supervisor Agent HLD - Rovo Service | 5442562478 | https://hello.atlassian.net/wiki/spaces/VPORT/pages/5442562478 | 2025-06-17 |
| 3 | HLD Planner | 5767347530 | https://hello.atlassian.net/wiki/spaces/VPORT/pages/5767347530 | 2025-09-01 |
| 4 | Planner Orchestrator Pipeline — Gap Analysis & Context Fidelity | 6807359582 | https://hello.atlassian.net/wiki/spaces/VPORT/pages/6807359582 | 2026-04-13 |
| 5 | Plan Quality Gate — Phase 2: Plan Accuracy Deep Dive & Root Cause Analysis | 6679749745 | https://hello.atlassian.net/wiki/spaces/VPORT/pages/6679749745 | 2026-03-20 |
| 6 | Execution Plan Validation - Design | 6296914291 | https://hello.atlassian.net/wiki/spaces/VPORT/pages/6296914291 | 2026-01-08 |
| 7 | Enabling Autonomous Mode for ITSD: Workflow & Handoff Design | 7040024988 | https://hello.atlassian.net/wiki/spaces/VPORT/pages/7040024988 | 2026-05-15 |
| 8 | Solution Design - Supervisor Agent | 5798739531 | https://hello.atlassian.net/wiki/spaces/VPORT/pages/5798739531 | 2025-09-08 |
| 9 | Supervisor Agent <> HR Onboarding Task Agents | 5969615431 | https://hello.atlassian.net/wiki/spaces/VPORT/pages/5969615431 | 2025-10-17 |
| 10 | Leveraging LLMs for Deterministic Jira Workflows: Challenges and Benefits | 6782291525 | https://hello.atlassian.net/wiki/spaces/agents/pages/6782291525 | 2026-04-09 |
| 11 | Planner Schema for Employee Service Agent | 6159061612 | https://hello.atlassian.net/wiki/spaces/VPORT/pages/6159061612 | 2025-12-03 |
| 12 | Q4 Plan Execution Roadmap | 6765910529 | https://hello.atlassian.net/wiki/spaces/~121596690/pages/6765910529 | 2026-04-07 |
| 13 | [HLD] Employee Onboarding Agent | 5829002081 | https://hello.atlassian.net/wiki/spaces/VPORT/pages/5829002081 | 2025-09-13 |

---

## Page 1: Rovo Service — 0 to 30% Deflection (Key Extracts)

**Context:** Achievement summary. Full agentic pipeline: retrieval → planning → execution → verification → evaluation.

### Key Quotes
- "Most of these requests already have documented runbooks, but historically a human agent still needed to read the runbook, interpret the ticket, ask follow-up questions, execute the steps, and close the issue."
- "Plan DAG validation was added to eliminate invalid progression logic. This change helped eliminate entire classes of failure, including plans that could route back into themselves or contain invalid progression logic."
- "This evaluation discipline is one of the main reasons iteration speed increased without sacrificing quality."
- "Each step compounded on the last. Retrieval, planning, execution, verification, evaluation, and operational instrumentation all moved forward in sequence — there was no single launch moment."
- "Going from zero to deflecting 30% of ITSD L1 tickets in four months is a strong signal that AI for service is no longer theoretical."

### Metrics
- Live deflection rate: ~30% of L1 ITSD tickets
- Execution success target: ~86% (by May 15 2026)
- Abandon cases: 26% of failures
- Top failure categories: integration failures, plan generation failures, incomplete runbooks

---

## Page 2: Supervisor Agent HLD (Key Extracts)

**Context:** High-level design of the supervisor+minion architecture.

### Agent Structure
- **Supervisor Agent**: Large reasoning model. Plans, orchestrates, evaluates.
- **Task Agents (Minions)**: Domain-specific agents. Each can have multiple tools. Examples: runbook search agent, clarifying question agent, planner agent, Okta agent.

### Supervisor Responsibilities Table
| Responsibility | Description | Sub-responsibilities |
|---|---|---|
| Reasoning | Understand the problem, workflow, skills needed | Domain understanding, current state analysis, problem complexity |
| Planning | Determine appropriate steps | Execution steps, agent selection |
| Orchestration | Coordinate with worker agents | A2A communication, agent looping, retracing steps, handoff to human |
| Decision-making & Evaluation | Choose right response from worker agents | Handoff to human, hallucination suppression, action rollback |

### Terminology
- **1P Agent**: Built by Atlassian products, on Rovo platform
- **Custom Agent**: Base Rovo agent from Agent Studio
- **Tools (Plugins/Actions)**: Integrations for 1P/3P systems (read or write)
- **Minion**: Any executable agent that handles a domain-specific task end-to-end

---

## Page 3: HLD Planner (Key Extracts)

**Context:** Three-component planner: Runbook Aggregator → Plan Generator → Plan Validator.

### Objective
"To ingest content of Runbook(s), user context and other metadata, and perform diagnosis and generate and validate the Plan, and identify which task agent responsible for those tasks."

### Three Components
1. **Runbook Aggregator** — Combines multiple runbooks into a customized runbook for the specific ticket
2. **Plan Generator** — Produces executable DAG from diagnosis + available task agents
3. **Plan Validator** — Validates against task agent capabilities + performs dry-run checks

### Plan Output Structure
- JSON blob representing the plan
- Validation flag + confidence score  
- Dry-run flag indicating whether execution validation was performed

### Data Class (from code)
```
data class Runbook:
  - content
  - metadata
  - validation_result
```

---

## Page 4: Planner Orchestrator Pipeline — Gap Analysis (Key Extracts)

**Context:** April 2026 analysis of structural weaknesses in the pipeline. Most actionable engineering doc.

### Core Diagnosis
"The pipeline does not maintain a single authoritative context object. Instead, each stage re-derives its own interpretation of the ticket, leading to semantic drift, silent information loss, and inconsistent planning."

### Pipeline Architecture (Mermaid)
```
flowchart TD
  Retrieval → Reranking → Aggregation → Planning → Orchestration
```

### 12 Identified Gaps & Solutions
1. **Retrieval Context** — Done ✅
2. **Planner Input / Canonical Context** — Partial 🟡
3. **Planner Prompt Grounding** — Partial 🟡
4. **Orchestrator Prompt / Context Layer** — Todo 🔴
5. **Aggregation Tool Contract** — Partial 🟡
6. **Plan Generation Tool Contract** — Partial 🟡
7. **Aggregation Grounding Validation** — Todo 🔴
8. **Summarized Comments in Planner Stage** — Done ✅
9. **Disable Parallel Tool Calls in Orchestrator** — Done ✅
10. **Typed Intermediate State in Orchestrator** — Partial 🟡
11. **Deterministic Retry Based on Validation** — Partial 🟡
12. **Canonical Context in Orchestrator Input** — Todo 🔴

### End-State Goal
"Every stage reads from the same `CanonicalTicketContext`. Intermediate outputs are typed, validated, and explicitly passed — not carried in LLM conversational memory."

### Feature Flags for Evaluation
- All changes gated behind feature flags for safe rollout
- Enables A/B comparison between variants

---

## Page 5: Plan Quality Gate — Phase 2 (Key Extracts)

**Context:** Deep dive on plan accuracy metrics, oscillation, and the critique/refiner loop.

### Problem Statement
After deploying critique/refiner loop, large-scale staging evaluations revealed a fundamental tension:
- Critique/refiner improved deflection accuracy BUT hurt plan accuracy
- Root cause: loop was over-correcting in some cases, creating oscillation

### Key Metrics (Run-by-Run)
- Run 11 (Mar 12): Plan accuracy high-water mark (baseline)
- Run 15 (Mar 17): Critique/refiner introduced — deflection up, plan accuracy down
- Run 22 (current best): 23 perfect plans (highest ever), detection rate 82.7% (highest ever), oscillation ~1%

### Oscillation Breakthrough
- Oscillation was at 58.6% across Runs 16-18 (main systemic problem)
- Cap applied: if MISSING_STEPS recurs across iterations, accept plan with warnings
- Run 21: Oscillation dropped to 5.1% | Run 22: 1.0%
- "Run 21 and Run 22 confirm the oscillation cap is working"

### Root Cause Categories
| Category | % of failures |
|---|---|
| Wrong runbook section retrieved | ~40% of regressions (Run 18) |
| Hallucinated team names | Present, being addressed |
| Self-assignment (no-self-INCOMING rule) | Fixed |
| Generic routing (L1 queue ambiguity) | Partially fixed |
| Branch complexity/schema limits | Ongoing |

### Key Insight on Evaluator
"Evaluator is Always Correct" — when evaluator flags something, it's a real issue. Team learned to trust evaluator output over human intuition in ambiguous cases.

---

## Page 6: Execution Plan Validation — Design (Key Extracts)

**Context:** Formal design for the validation layer. Two-pronged: deterministic + LLM-based.

### Two Validation Approaches Selected
1. **Deterministic Validation** (structural) — runs first, always
   - Broken step references
   - Unknown task agents
   - Invalid branching logic
   - Dead-end paths
   - Self-loops

2. **LLM-Based Validation** (semantic) — feature-flagged, runs after deterministic
   - Does plan match runbook intent?
   - Are steps semantically coherent?
   - Is agent selection appropriate?

### Rollout Strategy: Fail-Open → Fail-Closed
- Phase 1: **Fail-open** — plans always execute regardless of validation; results logged only
- Phase 2: Specific checks switch to **fail-closed** once precision is demonstrated
- Phase 3: Full enforcement

### Success Criteria
- Schema correctness
- Step relevance
- Agent appropriateness  
- Execution feasibility

### Architecture
"The handler: runs validation as an enrichment step; surfaces results via logs and metrics; integrates at plan persistence time (before execution)"

---

## Page 7: Enabling Autonomous Mode — Workflow & Handoff Design (Key Extracts)

**Context:** May 2026. How autonomous mode is triggered, queue structure, happy path, human handoff.

### Today's Human Workflow (baseline)
1. Ticket lands in L1 Untriaged queue
2. Human agent reads ticket, interprets it
3. Checks runbook or documentation
4. Asks follow-up questions if needed
5. Executes resolution steps
6. Closes or escalates ticket

### Autonomous Mode Trigger
- **JQL Rule** defines eligibility: tickets matching the rule enter Rovo's autonomous queue
- Example filter: `status = "Untriaged" AND issuetype = "Password Reset" AND assignee is EMPTY`

### Queue Structure
| Queue | Owner | Description |
|---|---|---|
| L1 Untriaged | Human agent | All incoming, not yet triaged |
| Rovo Autonomous | Rovo agent | JQL-filtered eligible tickets |
| L2 Technical | Human (L2) | Escalated complex tickets |
| Human Review | Human | Tickets Rovo attempted but couldn't resolve |

### Happy Path (Mermaid flowchart — summarized)
1. Ticket created → JQL rule evaluates eligibility
2. Eligible → moved to Rovo Autonomous queue
3. Rovo: retrieval → planning → execution → verification
4. Resolved → ticket closed automatically

### Human Handoff Scenarios
| Scenario | Trigger | Action |
|---|---|---|
| Low confidence | Plan confidence < threshold | Assign to Human Review queue with context |
| Execution failure | Task agent returns error | Rovo adds comment, escalates to L2 |
| Policy decision needed | Plan requires human judgment | Rovo asks clarifying question or escalates |
| Timeout | Step exceeds time limit | Escalate with partial progress |

---

## Page 8: Solution Design — Supervisor Agent (Key Extracts)

**Context:** The ESA's (Employee Service Agent) supervisor agent and its minions list.

### Minions of the Supervisor Agent (ESA)
1. Query Understanding Minion
2. Clarifying Questions Minion
3. Search Minion (runbook search)
4. Triage Minion
5. **Planner Minion** (plan generation + execution)
6. State/Memory Update handler

### Query Understanding and Search Loop
1. Supervisor invokes Query Understanding Minion
2. Minion formulates search query from ticket context
3. Search Minion retrieves runbooks
4. If results insufficient → loop: reformulate query → search again
5. Return top-N runbooks to supervisor

### Planner Minion: Plan Generation and Execution
1. Receives: aggregated runbook + ticket context + available task agents
2. Generates JSON execution plan (DAG)
3. Validates plan
4. Returns plan to supervisor

### Updating State and Memory
- Supervisor maintains conversational state across all minion invocations
- After each step: update ticket state in JSM
- Memory: summarized ticket history passed as context to each new invocation

### Milestone View for Hero Agents
- Milestone 1: Single agent, single tool
- Milestone 2: Single agent, multiple tools
- Milestone 3: Supervisor + task agents (current)
- Future: Full multi-agent with A2A communication

---

## Page 9: Supervisor Agent <> HR Onboarding Task Agents (Key Extracts)

**Context:** How supervisor delegates to HR Onboarding task agents. Key sequence diagram.

### Agent Selection: Two-Layer Approach
1. **Context Understanding Layer**: Invocation surface (where is request coming from?) + admin config (what's enabled for this request type?)
2. **Query Understanding Layer**: LLM reasoning about actual request content

"To ensure the skill/agent selection is highly deterministic in nature, we would first rely on the context understanding layer, followed by the query understanding layer if there is any further ambiguity."

### Supervisor Responsibilities (clear separation)
- "Plans, decomposes, and assigns tasks to minion (task) agents. Maintains global context and manages retries, handoffs, and escalation."
- "If a task agent needs to take a series of actions to complete its task, then this execution should be **fully handled by the task agent**, and not the Supervisor agent."

### Sequence: Supervisor → HM Task Agent (from Mermaid)
```
Workday triggers JSM Supervisory Agent
→ Supervisor creates Master JIRA Ticket
→ Supervisor triggers HM Task Agent + Context
  → HM Agent calls TWG API via Rovo Tools
  → HM Agent calls People API
  → HM Agent calls Talent API
  → HM Agent triggers Google Calendar Tool
  → HM Agent triggers Slack Tool
  → HM Agent returns response to Supervisor
→ Supervisor sends Draft Onboarding Plan to Slack
→ Human reviews and iterates (back-and-forth loop)
```

### Key Design Principles
- "Supervisor agent only deals with selecting the right task agent, sending a notification to the Hiring Manager, and having back-and-forth conversation"
- "HM Task agent handles the team onboarding plan creation end-to-end."

---

## Page 10: Leveraging LLMs for Deterministic Jira Workflows (Key Extracts)

**Context:** Core philosophy document. Explains WHY deterministic + probabilistic hybrid wins.

### Approach 1: Pure Agent/LLM (REJECTED)
Entire ticket handed to autonomous LLM loop. Challenges:
- **Non-Determinism**: LLMs are probabilistic. 99/100 correct, 1/100 hallucinates
- **High Latency**: 15-30 seconds per ticket (massive context window per step)
- **Runaway Costs**: Paying tokens for routing logic ("If Status = Open, Then...") that rules engines do for free
- **Auditing Nightmare**: Jira audit log shows "Updated by AI Agent" — no debuggability
- **Can't choose flexibility**: Can't pick where to be probabilistic vs non-negotiable

### Approach 2: Agents for Inference; Automations for Routing (SELECTED)
"Agents doing inference & reasoning; Automations/BPL do the routing, state management and execution."

Benefits:
- **Guaranteed Reliability**: IF/ELSE branches execute 100% correctly every time
- **Low Cost & Low Latency**: AI only for cognitive tasks (reading human text)
- **Native Auditability**: Jira Automation audit log shows exact path; debugging trivial
- **Graceful Degradation**: If LLM fails → deterministic fallback (e.g., assign to Unassigned queue with 'Needs Manual Triage' label)
- **Improvise and follow the rulebook**: Choose what parts are must-have vs flexible

### Key Quote
"The reality is even interactive agents (like Rovodev CLI) will opt for creating scripts (analogous to workflows) for this very reason - we're delivering a watered down capability by not deliberately leveraging both."

---

## Page 11: Planner Schema for Employee Service Agent (Key Extracts)

**Context:** JSON schema for the execution plan (DAG). The actual data structure used.

### Schema Structure Rules
- Steps are nodes in a directed step graph
- Each step has: id, taskAgent (or null for human handoff), execution, conditions, branches
- Conditions support: LLM-evaluated (semantic) and deterministic (rule-based)
- PostActions: atomic multi-action steps (all must complete before moving on)

### Step Types
- **Normal step**: taskAgent + execution → next step
- **Waiting step**: waitForExternalInput: true → pause for user clarification
- **Branch step**: multiple conditions → different next steps
- **Human handoff step**: taskAgent: null → escalate to human

### Example: Human Handoff Step
```json
{
  "id": "step-handoff",
  "taskAgent": null,
  "execution": {
    "action": "ESCALATE_TO_HUMAN",
    "reason": "Requires policy decision"
  }
}
```

### Example: Branch Step
```json
{
  "id": "step-check-result",
  "conditions": [
    { "if": "result == 'success'", "next": "step-close-ticket" },
    { "if": "result == 'failure'", "next": "step-handoff" }
  ]
}
```

---

## Page 12: Q4 Plan Execution Roadmap (Key Extracts)

**Context:** Live roadmap tracking execution success improvements.

### Current State
- Execution Success: **60%** (excluding abandon cases)
- Target: **~86%** by May 15, 2026
- Abandon cases: **26%** of all cases

### Top Failure Categories (Abandon Cases — 26%)
1. Integration failures (tool call errors, 429s, timeouts)
2. Plan generation failures (planner returns invalid plan)
3. Incomplete/wrong runbook retrieved
4. Human resolved before Rovo could act (race condition)

### Improvement Initiatives (Roadmap)
| Initiative | Impact | Status |
|---|---|---|
| Reduce integration errors | High | In progress |
| Improve runbook retrieval | High | In progress |
| Plan validation hardening | Medium | Partially done |
| Oscillation cap | High | Completed (Run 22) |
| Canonical context object | High | In progress |
| Parallel tool call disable | Medium | Done |

---

## Page 13: [HLD] Employee Onboarding Agent (Key Extracts)

**Context:** Full HLD for HR Onboarding use case. Different from ITSD but same supervisor+task agent pattern.

### High-Level Architecture Components
**Human actors:** New Hire, Hiring Manager, HR Admin
**Core Components:**
- JSM Supervisor Agent (orchestrator)
- Journey Template Generator
- Journey Personalisation Engine
- Progress Monitor

**Task Agents:**
- Hiring Manager Task Agent
- New Hire Task Agent  
- HR Admin Task Agent
- Google Calendar Tool Agent

### Key Design: Automation as Orchestration Backbone
"Orchestration starts from the automation rule backing the configured journey."

Journey Builder (BPL - Business Process Logic) handles:
- State machine for onboarding progress
- Trigger conditions (offer accepted → start onboarding)
- Milestone tracking
- Stale journey detection (trigger if journey hasn't progressed)

### Journey Template Generation
- LLM generates personalized journey template from new hire data
- Template validated before execution
- Human (HR Admin) approves before rollout

### Stale Journey Detection
- Scheduled checks on journey progress
- If no progress in N days → supervisor re-evaluates, may re-trigger task agent or escalate

---

## Raw Source URLs
All pages live at: https://hello.atlassian.net/wiki/spaces/VPORT/ (and related spaces)
