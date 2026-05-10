# Agentic Workflow Ideas — DBOS Platform

**Date:** 2026-05-09
**Context:** Ideas to add genuine "agency" to the existing DBOS PoC. Scoped to: algo trading risk analysis + report/insight generation. Voice excluded.

---

## Executive Summary

8 concrete, buildable agentic ideas ranked below. Biggest surprise: **DBOS has an official GA integration with OpenAI Agents SDK (March 2026)** via `DBOSRunner.run()` — a drop-in replacement for the standard runner that makes every agent call durable. The simplest starting point is either a **structured output agent with Zod validation** (1-2 days, direct swap for mockAgent.ts) or a **bull vs. bear analyst debate** (1-2 days, highly demonstrative).

---

## What Makes Something "Agentic" vs Deterministic?

```
DETERMINISTIC (what we have now)          AGENTIC (what we're adding)
─────────────────────────────────         ────────────────────────────
Fixed steps, fixed order                  LLM decides what to do next
Pre-defined tools always called           LLM selects which tools to call
Output shape always the same              LLM reasons about output quality
No self-correction                        LLM critiques and retries itself
Single model call                         Multi-turn reasoning loops
```

In our current PoC: `readSalesData → aggregateSales → mockAgent → writeInsights`
The "agent" is a fake — it's a pure function returning canned insights. The LLM makes zero decisions.

---

## 8 Agentic PoC Ideas (Ranked by Simplicity + Value)

### #1 — Structured Output Agent with Validation Loop ⭐⭐⭐⭐⭐
**1-2 days | Lowest friction — direct swap for mockAgent.ts**

**What's agentic:** LLM generates a `SalesInsightReport` shaped by a Zod schema. If validation fails or confidence is low, agent retries with tighter constraints. The LLM decides what to include and whether its own output is good enough.

```typescript
// Vercel AI SDK — ~20 lines
const { object } = await generateObject({
  model: openai("gpt-4o"),
  schema: z.object({
    summary:         z.string(),
    topProduct:      z.string(),
    topRegion:       z.string(),
    riskFlags:       z.array(z.string()),
    confidence:      z.number().min(0).max(1),
    recommendations: z.array(z.string())
  }),
  prompt: `Analyse this sales data and generate insights: ${JSON.stringify(aggregated)}`
});
if (object.confidence < 0.7) throw new Error("Low confidence — DBOS will retry");
```

**DBOS integration:** Wrap in `DBOS.runStep()` with `retriesAllowed: true`. Low confidence = throw = DBOS retries automatically.
**Framework:** Vercel AI SDK (`generateObject` + Zod)
**Key learning:** Type-safe LLM outputs, automatic validation + retry loop, cost control.

---

### #2 — Bull vs. Bear Analyst Debate ⭐⭐⭐⭐⭐
**1-2 days | Most visually impressive demo**

**What's agentic:** Two LLM agents with opposing instructions debate the quality of an insight. The "bull" argues the sales trend is strong; the "bear" pokes holes. A third "consensus" agent settles on a final verdict + confidence score.

```typescript
// OpenAI Agents SDK TS + DBOSRunner
async function debateAnalysis(aggregated: AggregatedSales) {
  const bullView  = await DBOS.runStep(() => DBOSRunner.run(bullAgent,  JSON.stringify(aggregated)));
  const bearView  = await DBOS.runStep(() => DBOSRunner.run(bearAgent,  `Critique: ${bullView}`));
  const consensus = await DBOS.runStep(() => DBOSRunner.run(judgeAgent, `Decide: ${bullView} vs ${bearView}`));
  return { bullView, bearView, consensus };
}
```

**DBOS integration:** Each agent call = a durable step. LLM API failure retries automatically via `DBOSRunner`.
**Framework:** OpenAI Agents SDK TS — native DBOS integration via `DBOSRunner` (GA March 2026).
**Key learning:** Multi-agent debate, disagreement as uncertainty signal, multi-turn reasoning.
**Research basis:** FactorMAD (ACM AI in Finance 2025), TradingAgents (arxiv 2412.20138).

---

### #3 — Reflexion Loop (Agent Self-Critiques Its Own Report) ⭐⭐⭐⭐
**2-3 days | Excellent for report generation use case**

**What's agentic:** Draft report generated → critic agent identifies weaknesses → writer agent revises → quality gate checks improvement score → loop max 2 rounds.

```typescript
async function reflexionReport(aggregated: AggregatedSales) {
  let draft = await DBOS.runStep(() => generateDraft(aggregated));
  for (let i = 0; i < 2; i++) {
    const critique = await DBOS.runStep(() => generateCritique(draft));
    if (critique.score > 8) break;       // good enough
    draft = await DBOS.runStep(() => reviseDraft(draft, critique));
  }
  return draft;
}
```

**DBOS integration:** Each reflection round is a checkpoint — crash mid-critique, resume from last good draft.
**Framework:** Vercel AI SDK or LangGraph JS.
**Key learning:** Structured self-critique, iteration budgets, quality gates.
**Research basis:** Reflexion paper (arxiv 2303.11366), LangChain reflection agents blog.

---

### #4 — ReAct Agent for Adaptive Tool Selection ⭐⭐⭐⭐
**2-3 days | Shows true tool-using agency**

**What's agentic:** Instead of always calling all tools, the agent decides which tools to call based on the query. "Calculate VIX-adjusted volatility for tech sector" → agent selects `fetchVIX` + `fetchSectorData`, NOT `fetchEarnings`.

```typescript
// LangGraph JS — createReactAgent
const agent = createReactAgent({
  llm: new ChatOpenAI({ model: "gpt-4o" }),
  tools: [fetchVIX, fetchSectorData, fetchEarnings, calculateVolatility],
});

// Wrap entire ReAct loop as a single durable DBOS step
const result = await DBOS.runStep(() =>
  graph.invoke({ messages: [{ role: "user", content: query }] })
);
```

**DBOS integration:** Entire ReAct loop wrapped as one durable step.
**Framework:** LangGraph JS (`createReactAgent`) + DBOS PostgresSaver.
**Key learning:** Dynamic tool selection, iterative reasoning from observations.

---

### #5 — Agent Handoff Pipeline (Researcher → Writer → Reviewer) ⭐⭐⭐⭐
**2-3 days | Best fit for report generation**

**What's agentic:** Three specialist agents each own a phase. Each decides autonomously when it's done and hands off. The Reviewer can send work back to the Writer.

```typescript
// OpenAI Agents SDK — built-in handoffs
const researcher = new Agent({ name: "researcher", handoffs: [writer] });
const writer     = new Agent({ name: "writer",     handoffs: [reviewer, researcher] });
const reviewer   = new Agent({ name: "reviewer",   handoffs: [writer] });

// DBOSRunner makes entire chain durable
const result = await DBOS.runStep(() =>
  DBOSRunner.run(researcher, `Generate Q2 sales report for: ${JSON.stringify(data)}`)
);
```

**DBOS integration:** `DBOSRunner.run()` makes the entire handoff chain durable.
**Framework:** OpenAI Agents SDK TS — built-in handoff support.
**Key learning:** Decentralised routing, specialist agents, autonomous workflow control.

---

### #6 — Plan-and-Execute for Multi-Section Reports ⭐⭐⭐
**3-4 days | Complex decomposition**

**What's agentic:** Agent plans a JSON outline of report sections. DBOS executes each section as a parallel durable step. Final agent synthesises.

```typescript
async function planExecuteReport(query: string) {
  const { object: plan } = await DBOS.runStep(() => generateObject({
    schema: z.object({ sections: z.array(sectionSchema) }),
    prompt: `Plan report sections for: ${query}`
  }));
  const drafts = await Promise.all(
    plan.sections.map(s => DBOS.runStep(() => draftSection(s)))  // parallel!
  );
  return await DBOS.runStep(() => synthesise(drafts));
}
```

**DBOS integration:** DBOS parallel fan-out — each section is an independent checkpoint.
**Framework:** Vercel AI SDK `generateObject` + DBOS parallel steps.
**Key learning:** Task decomposition, dynamic DAG, parallel durable execution.

---

### #7 — Human-in-the-Loop Approval Gate ⭐⭐⭐
**3-4 days | Critical for trading compliance**

**What's agentic:** When agent confidence < threshold OR risk score > limit, workflow pauses durably and waits for human approval via DBOS events before executing any trade action.

```typescript
async function riskWorkflowWithApproval(analysis: RiskAnalysis) {
  if (analysis.confidence < 0.8 || analysis.riskScore > 7) {
    await DBOS.setEvent("pending_approval", { analysis });
    const approval = await DBOS.recv<ApprovalDecision>("approval_response", 86400); // 24h
    if (!approval || approval.decision === "reject") return { status: "rejected" };
  }
  return await DBOS.runStep(() => executeTradeAdjustment(analysis));
}
```

**DBOS integration:** `DBOS.setEvent` / `DBOS.recv` — built-in durable pause. Process can crash; workflow resumes when signal arrives.
**Framework:** DBOS native events — no extra framework needed.
**Key learning:** Durable human-in-the-loop, event-driven workflow control, compliance gates.

---

### #8 — Memory-Augmented Agent (Learns from Past Analyses) ⭐⭐
**3-4 days | Most advanced**

**What's agentic:** Agent queries a vector DB of prior analyses before running a new one. "Last time we saw a LATAM revenue dip, FX was the driver — let me check FX first."

**Framework:** LangGraph JS + pgvector (or LlamaIndex for retrieval).
**Key learning:** Episodic memory, RAG for agent context, learning from history.

---

## Framework Decision Guide

| Use case | Best framework | Why |
|---|---|---|
| Quick first agentic swap | **Vercel AI SDK** | `generateObject` + Zod, ~20 lines, zero new infra |
| Multi-agent debate / handoffs | **OpenAI Agents SDK TS** | Native DBOS integration via `DBOSRunner` (GA March 2026) |
| Complex tool selection / ReAct | **LangGraph JS** | `createReactAgent`, PostgresSaver for state |
| Full TS-native multi-step | **Mastra** | TypeScript-first, Zod tools, built-in `.then()/.branch()` |

---

## The Key Integration Discovery

DBOS v4 has an official integration with OpenAI Agents SDK (March 2026):

```typescript
// Before (standard runner — not durable):
const result = await Runner.run(agent, input);

// After (DBOSRunner — fully durable, auto-retries, checkpointed):
const result = await DBOSRunner.run(agent, input);
```

That's it. One line change. Every agent tool call becomes a durable DBOS step.
- Docs: https://docs.dbos.dev/integrations/openai-agents
- Blog: https://www.dbos.dev/blog/dbos-new-features-march-2026

---

## Recommended First Step for Current PoC

**Swap `mockAgent.ts` for real LLM** using Vercel AI SDK:
1. `npm install ai @ai-sdk/openai`
2. Replace `mockAgent.ts` body with `generateObject()` (~20 lines)
3. Add `OPENAI_API_KEY` to `.env`
4. The existing `retriesAllowed: true` in `runAnalysisAgent` handles API failures automatically

This is idea #1 from the list — lowest friction, highest immediate value.

---

---

## DBOS Control Flow — Loops, Branching, Complex State (Validated)

**Source:** https://docs.dbos.dev/typescript/tutorials/workflow-tutorial

<cite index="21-7,21-8">Workflows are in most respects normal TypeScript functions. They can have loops, branches, conditionals, and so on.</cite> The one constraint: <cite index="21-9,21-10,21-11">a workflow function must be deterministic. If you need non-deterministic operations like accessing a database, calling a third-party API, or generating a random number, do them inside steps — not directly in the workflow function.</cite>

From the DBOS homepage: <cite index="26-1,26-2">write your business logic in normal code, with branches, loops, subtasks, and retries — DBOS makes it resilient to any failure.</cite>

### The key rule for loops

Step names must be unique per iteration, otherwise DBOS can't distinguish step outputs during replay:

```typescript
// ✅ correct — unique name per iteration
for (const month of months) {
  await DBOS.runStep(
    () => analyzeMonth(month),
    { name: `analyzeMonth-${month}` }  // "analyzeMonth-2025-01", etc.
  );
}
```

### Also discovered: `forkWorkflow` + `listWorkflowSteps` (v4 API)

<cite index="24-2">You can find all workflows that errored in a time range, check which step failed, and use `DBOS.forkWorkflow(workflowID, stepIndex)` to restart those workflows from a specific step.</cite> This is powerful for operational recovery — e.g., restart all workflows that failed at step 2 due to a service outage, without re-running steps 1.

### DBOS vs LangGraph for control flow

| | DBOS | LangGraph |
|---|---|---|
| Branching | Plain `if/else` in TS | Conditional edges in graph |
| Loops | Plain `for/while` in TS | Explicit cycle edges |
| Readability | Natural — just code | More ceremony, more visual |
| Debuggability | Postgres step history | LangSmith graph trace viewer |
| Durability | Built-in | Needs checkpointer |

**Bottom line:** DBOS is simpler for loops/branching. LangGraph is better when you want to *visualise* the state machine or need complex conditional routing between many agents.

---

## References

| Resource | URL |
|---|---|
| DBOS + OpenAI Agents integration (GA Mar 2026) | https://docs.dbos.dev/integrations/openai-agents |
| Vercel AI SDK `generateObject` | https://vercel.com/docs/ai-sdk |
| LangGraph JS quickstart | https://langgraphjs.guide/quickstart/ |
| OpenAI Agents SDK TS | https://openai.github.io/openai-agents-js/ |
| Mastra docs | https://mastra.ai/docs |
| TradingAgents paper | https://arxiv.org/abs/2412.20138 |
| Reflexion paper | https://arxiv.org/abs/2303.11366 |
| LangChain reflection agents | https://blog.langchain.com/reflection-agents/ |
| DBOS + LangGraph durable agents | https://www.dbos.dev/blog/durable-execution-crashproof-ai-agents |
| Vercel AI SDK 6 announcement | https://vercel.com/blog/ai-sdk-6 |
