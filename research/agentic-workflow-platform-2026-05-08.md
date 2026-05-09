# Agentic Workflow Platform — Market Research

**Date:** 2026-05-08
**Author:** Rovo Dev (research mode)
**Scope:** Polyglot (Py + TS, JVM noted), full landscape (durable execution + agent frameworks + voice stacks + ops/viz), self-hosted Kubernetes

---

## Executive Summary

You are building a deterministic, fault-tolerant **agentic workflow platform** on self-hosted K8s with three concrete use cases: market-risk calculation for algo trading, report/insight generation, and rules-based voice AI agents. The pattern you proposed — **"narrow agents + utility services orchestrated by a durable workflow engine"** — is now industry best practice in 2026, validated across LangGraph, DBOS, Temporal, OpenAI Agents SDK, and Pydantic-AI documentation.

**Headline recommendation:** Build the platform on **Temporal** (durable orchestration) + **Pydantic-AI / LangGraph / OpenAI Agents SDK** (narrow agents, language-of-choice) + **LiveKit Agents or Pipecat** (voice transport) + **Langfuse + OpenTelemetry GenAI SemConv** (LLM/agent observability), all self-hosted via Helm on K8s. Evaluate **DBOS in parallel** as a lighter-weight Postgres-native alternative for teams that want to skip operating a Temporal cluster — particularly attractive given DBOS's first-party integrations with Pydantic-AI and OpenAI Agents SDK and its time-travel debugger.

**Key bullet findings:**
- Temporal vs DBOS is no longer a "vs" — they target different operational profiles. Temporal = battle-tested cluster, polyglot SDKs (Py/TS/Java/Go/.NET), strict determinism. DBOS = library + Postgres only, minimal infra, Postgres-bound throughput, time-travel debugger.
- **Restate** is the pragmatic dark-horse explicitly positioning for AI/agents — lightweight (~100MB binary), polyglot, but smaller community and less battle-tested.
- For voice: **LiveKit Agents** (proven at OpenAI/Character.ai/Speak/Retell) and **Pipecat** (with Pipecat Flows for state machines) are the only credible self-hostable open-source options. Vapi/Retell/OpenAI Realtime are SaaS-only.
- For agent frameworks: **LangGraph** for graph state machines, **Pydantic-AI** for type-safe Python agents, **OpenAI Agents SDK** for OpenAI-heavy stacks, **Mastra** for TS-first teams. Avoid CrewAI/AutoGen for deterministic narrow-agent patterns.
- For ops/viz: **Langfuse** (OSS, self-hostable on K8s with Postgres+ClickHouse+Redis+S3) is the clear LLM observability winner, paired with **OpenTelemetry GenAI semantic conventions** to unify workflow traces with LLM spans.

---

## 1. The Architectural Pattern: Narrow Agents + Durable Orchestrator

The pattern you described is now an explicit industry consensus. The split:

```
┌────────────────────────────────────────────────────────────────┐
│  Durable Workflow Engine (Temporal / DBOS / Restate)           │
│  - Deterministic orchestration logic                            │
│  - Replay-safe, fault-tolerant, auditable event history         │
│  - Signals, timers, child workflows, sagas                      │
└──────────────┬─────────────────────────────────────────────────┘
               │ calls (as activities / steps / functions)
               ▼
┌────────────────────────────────────────────────────────────────┐
│  Narrow Agents (Pydantic-AI / LangGraph / OpenAI SDK / Mastra)  │
│  - Single-purpose, tool-using LLM agents                        │
│  - Non-deterministic LLM calls isolated here                    │
│  - Structured I/O via Pydantic / Zod                            │
└──────────────┬─────────────────────────────────────────────────┘
               │ uses
               ▼
┌────────────────────────────────────────────────────────────────┐
│  Utility Services & Tools                                       │
│  - Market data, pricing engines, CRM, calendar, reporting DBs   │
│  - Exposed via MCP servers, gRPC, REST                          │
└────────────────────────────────────────────────────────────────┘
```

**Why this split:** the workflow engine guarantees infrastructure-level reliability (crashes, restarts, partitions). The agent framework provides application-level reasoning structure (tool selection, chain-of-thought, structured output). Mixing the two in a single tool causes pain — e.g., LangGraph checkpointers save state *between* nodes, not *inside* a node, so an in-flight LLM call inside a node will be lost on crash. That gap is exactly what Temporal/DBOS fill.

---

## 2. Durable Execution Engine — Temporal vs DBOS vs Restate (and the field)

### 2.1 Head-to-head matrix (the three you should actually consider)

| Dimension | **Temporal** | **DBOS** | **Restate** |
|---|---|---|---|
| **Maturity** | 6+ years, Stripe/Snap/Coinbase/DoorDash | Newer, growing | v1.2+ in 2025, emerging |
| **Programming model** | Workflow-as-code with strict activity/workflow boundary | Decorators (`@DBOS.workflow`, `@DBOS.step`) — library, in-process | Durable RPC functions / Virtual Objects |
| **Durability mechanism** | Event-sourced history (replay) | Postgres snapshots of execution state | Postgres / RocksDB snapshots |
| **Determinism strictness** | Strictest (sandbox) | Moderate, library-level | Moderate — explicitly pragmatic for AI |
| **Infra you must run** | Temporal cluster (Frontend/History/Matching) + Postgres/Cassandra/MySQL + Workers | Postgres only — DBOS is a library inside your app | Single binary + Postgres |
| **Resource footprint** | ~4 GB minimum cluster | Negligible (library) | ~100 MB binary |
| **Throughput ceiling** | Cluster size you're willing to run | Your Postgres | Postgres / Restate cluster |
| **SDK languages** | Python, TypeScript, Java, Go, .NET, Ruby (all mature) | Python, TypeScript | TS, Python, Java/Kotlin (mature); Go (emerging) |
| **Helm / K8s** | Official Helm chart, Worker Controller (CRDs), 2048 shards recommended | Just deploy your app + Postgres | Single-binary deployment, HA from v1.2 |
| **Built-in UI** | Temporal Web (event history, replay via CLI) | DBOS Console + **VS Code Time-Travel Debugger** (replay any cloud trace locally and edit code) | Restate UI (filter invocations, inspect Virtual Object state) |
| **First-party agent integrations** | OpenAI Agents SDK (2025), Pydantic-AI | Pydantic-AI (`DBOSAgent` wrapper), OpenAI Agents, LlamaIndex, LangGraph (`PostgresSaver`) | Examples for AI workflows / agents |
| **Lock-in** | Medium (gRPC spec is open) | High (Postgres + Py/TS) | Low (single binary) |
| **License** | Apache 2.0 | Apache 2.0 (Transact) | BSL / Apache 2.0 |
| **Best for** | Polyglot platform, fintech-grade auditability, scale | Lightweight Py/TS teams that already run Postgres; debugging | Greenfield agent-first projects |

### 2.2 Why Temporal is the safest "primary"

- **Polyglot.** It is the only credible engine where Python, TypeScript, Java, Go are all production-mature — directly aligned with your "Polyglot / Both" choice.
- **Fintech-grade auditability.** Event-sourced history is immutable; every workflow decision is replayable. This is what regulated trading workloads (use case 1) actually need.
- **Proven at scale.** Stripe (payment settlement), DoorDash, Coinbase, Snap, OpenPhone (built a real-time voice agent with Temporal — directly relevant to use case 3).
- **K8s story.** Official Helm chart, Worker Controller CRD, **Worker Versioning** lets old workflows finish on old code while new workflows run on new code — critical for an internal platform.
- **Trade-offs.** Strictest determinism (you must isolate LLM calls into activities), 4 GB minimum cluster, more operational surface than DBOS. The Activity/Workflow boundary has a real learning curve.

### 2.3 Why DBOS is the strongest secondary (and may even win for you)

- **Zero new infrastructure.** DBOS runs as a library inside your existing Python/TypeScript service, persisting state to the same Postgres you're already using. For a small platform team, that's a massive operational win.
- **Direct fit to your "narrow agents" pattern.** DBOS ships first-party `DBOSAgent` wrappers for Pydantic-AI and integrations for OpenAI Agents and LlamaIndex. The pattern documented in DBOS+LangGraph case studies — `@DBOS.workflow` on the orchestrator, `@DBOS.step` on each tool, `@tool` decorator to expose the workflow back to the LLM — is exactly the "narrow agents + utility services" pattern you described.
- **Time-Travel Debugger is unique.** A VS Code extension that lets you replay any production trace locally **and modify the code** as if the new code had run in the past. Nothing else in the field has this.
- **Trade-offs.** Throughput ceiling = your Postgres. Less polyglot (Py/TS only — no JVM). Younger, smaller community. Higher lock-in to Postgres + Py/TS.

### 2.4 Restate — the dark horse worth a one-week PoC

- Single binary, Apache 2.0, explicitly positioning for AI workflows.
- More pragmatic determinism than Temporal (friendlier for non-deterministic agent code).
- Smaller community (~3.8k GitHub stars vs Temporal's ~20k), less battle-tested.
- Worth keeping on the radar but not a primary bet for a platform that has to host trading workloads.

### 2.5 The rest, briefly

- **Inngest** — excellent for event-driven serverless workflows; not great for long-running stateful agents. Not self-hostable in production (cloud-licensed).
- **Hatchet** — DAG-based, purpose-built for AI pipelines (priority lanes, rate limiting, concurrency keys), pre-1.0 but interesting for the report-generation use case.
- **Prefect** — Python-only, data-pipeline focus, excellent UI; ruled out by polyglot requirement.
- **Cadence** — Temporal's predecessor, declining; new projects should not start here.
- **Windmill / Trigger.dev** — low-code / integration-first; not designed for agent orchestration.
- **AWS Step Functions** — cloud-only; ruled out by self-hosted requirement.

---

## 3. Narrow Agent Frameworks — what to call from inside the workflow

### 3.1 The shortlist for your use cases

| Framework | Lang | Tool / structured output | Built-in durability (off-able?) | Pairs with | Best use case |
|---|---|---|---|---|---|
| **Pydantic-AI** | Py | Pydantic-typed I/O, FastAPI-feel, Logfire/OTel | Optional (pluggable; supports DBOS, Temporal) | DBOS, Temporal | **Risk calc**, type-safe agents |
| **LangGraph** | Py, TS | Graph state machines, streaming v3, Pydantic | Yes (checkpointer) — can be left off in favour of Temporal/DBOS | DBOS (PostgresSaver), Temporal | Multi-step research/report flows |
| **OpenAI Agents SDK** | Py, TS | Handoffs, Guardrails, Sessions, native Realtime API | None (intentional) | DBOS (officially documented), Temporal (2025 integration) | Voice agents (Realtime), OpenAI-heavy stacks |
| **Mastra** | TS | Zod-typed, Mastra Studio | Partial; pairs with Inngest or external | Inngest, self-hosted | TS-first report/insights |
| **Claude Agent SDK** | Py, JS | MCP, computer use, extended thinking | None | DBOS, Temporal | Reasoning-heavy reports |
| **LlamaIndex Workflows** | Py, TS | Event-driven multi-step | None | DBOS | Document/RAG-heavy reports |
| **CrewAI** | Py | Role-based, Pydantic outputs | None | Inngest, Temporal | Autonomous teams (less fit for narrow-agent pattern) |
| **AutoGen / AG2** | Py, .NET | Conversational debate | None | external | **Avoid** — fragmented (AutoGen → maintenance, AG2 fork, MS Agent Framework successor) |
| **Google ADK** | Py | A2A protocol, multimodal | Vertex managed | Vertex Workflows | Skip unless you commit to Vertex (not self-hosted) |

### 3.2 Recommended pairings

- **Use case 1 (market-risk for algo trading):** Pydantic-AI (type-safe risk inputs/outputs) wrapped in Temporal activities, called from a deterministic Temporal Workflow. Or DBOS `@workflow` + `DBOSAgent(pydantic_ai_agent)` if you go DBOS.
- **Use case 2 (reports & insights):** LangGraph (multi-step research → synthesise → critique) or Mastra (TS), with each step as a Temporal activity / DBOS step. Add LlamaIndex for any RAG-heavy retrieval.
- **Use case 3 (rules-based voice agent):** OpenAI Agents SDK (Realtime API) or Pydantic-AI, hosted inside a LiveKit/Pipecat agent process, with Temporal/DBOS workflows behind it for any side-effects (booking, transactions, follow-ups).

### 3.3 Anti-patterns to avoid

- **Using LangGraph alone for production durability.** LangGraph checkpointers save state between nodes, not inside a node — mid-LLM-call crashes lose work. Pair with Temporal/DBOS.
- **CrewAI for deterministic flows.** It's designed for autonomous teams; it has no built-in durability beyond task outputs.
- **AutoGen for new projects.** The framework split into Microsoft Agent Framework + community AG2 + maintenance-mode original; ecosystem is fragmented.

---

## 4. Voice AI Stack — Self-Hostable Options

### 4.1 The brutal triage

| Stack | Self-hostable on K8s? | Verdict |
|---|---|---|
| **LiveKit Agents** | ✅ Apache 2.0, full stack open-source, K8s-ready | **Recommended #1** |
| **Pipecat (Daily.co)** | ✅ OSS, vendor-neutral, includes Pipecat Flows | **Recommended #2** |
| OpenAI Realtime API | ❌ SaaS only (but pairs with self-hosted transport) | Use as model behind LiveKit/Pipecat |
| Vapi | ❌ Proprietary SaaS | Ruled out |
| Retell AI | ❌ SaaS only | Ruled out (despite excellent ~600ms latency and flow builder) |
| Deepgram Voice Agent / ElevenLabs Conversational | ❌ SaaS APIs | Use as STT/TTS providers behind LiveKit/Pipecat |
| Twilio ConversationRelay | ❌ SaaS | Ruled out |
| Google Vertex Conversational | ❌ Cloud-only | Ruled out |

### 4.2 LiveKit Agents — why it wins

- **Polyglot.** Python + Node.js SDKs natively; matches your polyglot choice.
- **Two architectures.** `MultimodalAgent` (OpenAI Realtime speech-to-speech) for lowest latency, or `VoicePipelineAgent` (STT → LLM → TTS) for control over each stage.
- **Production references.** OpenAI, Character.ai, Retell, and Speak built on LiveKit.
- **Telephony + WebRTC.** Native WebRTC media server plus full SIP/PSTN telephony stack.
- **Semantic turn detection** with a transformer-based model — critical for natural conversation.
- **K8s-native.** Built-in agent server orchestration, load balancing, K8s compatibility documented.
- **Native MCP support** — one line of code to integrate MCP-served tools.

### 4.3 Pipecat — equally viable, especially for rules

- **Pipecat Flows is the killer feature** for your rules-based requirement. It implements the workflow-state pattern explicitly: each state has a system instruction, a context transformation (LLM prompt that summarises previous state), the tools available in that state, and the next states the LLM may transition to. That is precisely "rules-based voice agent" expressed in code.
- 40+ AI services as plugins; Python + JS + React + iOS + Android + C++.
- Telephony (PSTN, SIP), Daily WebRTC, FastAPI WebSocket, LiveKit transport interop.
- Slightly newer ecosystem than LiveKit but fast-growing.

### 4.4 Recommended voice architecture (matches OpenPhone's actual production design)

```
Phone / Browser
      │ SIP / WebRTC
      ▼
LiveKit Agent (or Pipecat) — stateless, scales horizontally on K8s
  - STT (Deepgram), LLM (OpenAI / Claude / OpenAI Realtime), TTS (ElevenLabs / Cartesia)
  - Pipecat Flows OR coded state machine for rules
  - Tool calls forwarded to Temporal workflows via gRPC/HTTP
      │ signals / queries
      ▼
Temporal Workflow — durable, deterministic
  - Holds conversation state across turns
  - Orchestrates side-effects (book appointment, update CRM, send confirmation)
  - Activities = LLM calls, tool invocations, async API calls
      │
      ▼
Utility services (CRM, scheduling, payment, …) — exposed via MCP / gRPC
```

This is essentially the architecture OpenPhone described publicly when they built their real-time voice agent on Temporal.

---

## 5. Operational Tooling — Debugging, Visualisation, K8s Self-Host

### 5.1 The recommended ops stack

| Layer | Component | Why |
|---|---|---|
| Workflow orchestrator UI | **Temporal Web** (or DBOS Console + Time-Travel Debugger) | Native event history, namespace switching, child-workflow tree |
| LLM/agent observability | **Langfuse** (OSS, Helm-deployable) | Hierarchical traces, prompt management, LLM-as-a-Judge evals, native cost tracking |
| Tracing standard | **OpenTelemetry GenAI semantic conventions** (`gen_ai.*`) | Unifies workflow spans (Temporal) with LLM spans across all SDKs |
| Trace backend | **Tempo** (or Jaeger) | OTLP-native, scales via ClickHouse |
| Metrics | **Prometheus** | OTel exports `gen_ai.usage.input_tokens`, latency histograms, etc. |
| Logs | **Loki** | Worker logs, errors |
| Dashboards | **Grafana** | Single pane: workflow + LLM + cost |
| Optional eval | Arize Phoenix (OTel-native) | Framework-agnostic auto-instrumentation if you don't want SDK callbacks |
| Optional gateway | Helicone / Portkey | Cost control, fallbacks, rate limiting |

### 5.2 Why Langfuse for your platform

- **Self-host on K8s by Helm** is the *preferred production deployment* per Langfuse docs. Stack is two app containers (Web + Worker) + Postgres (transactional) + ClickHouse (OLAP traces) + Redis (queue/cache) + S3 / MinIO (events/exports).
- **Air-gappable.** No outbound calls required after image pull — important if you're running this near trading systems.
- **Hierarchical tracing** of LLM calls + tool invocations + retrieval — directly maps to your narrow-agent pattern.
- **Built-in prompt management with version control** — lets your platform users iterate on prompts without redeploying code.
- **Cost tracking by model, provider, user, session** out of the box.

### 5.3 OpenTelemetry GenAI conventions are now stable enough to bet on

- Standard span attributes: `gen_ai.request.model`, `gen_ai.usage.{input,output}_tokens`, `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.response.finish_reason`.
- **Agentic extensions** are in development (tasks, actions, agents, teams, artifacts, memory) — early but worth tracking.
- The pattern: workflow span (Temporal/DBOS) → activity/step span → `gen_ai.chat` span → tool execution span. Single OTel Collector receives both, correlates via trace ID.

### 5.4 Multi-tenant internal platform pattern

```
K8s namespace per team
  └ Temporal namespace per tenant (registered via tctl, version-controlled)
  └ Langfuse project per tenant (isolated API keys)
  └ Worker pods auto-registered via ArgoCD ApplicationSet (GitOps)

Cross-cutting:
  - Sealed Secrets / External Secrets Operator for API keys
  - Temporal Worker Versioning + Worker Controller CRD for safe rollouts
    (in-flight workflows finish on old code, new workflows on new code)
  - Karpenter / KEDA for autoscaling workers on queue depth
  - Per-tenant cost dashboards in Grafana from Langfuse + OTel metrics
```

This is the IDP backbone you'll need for the "north star" — quick onboard, deploy, debug, visualise.

---

## 6. Use-Case-Specific Recommendations

### 6.1 Market-risk for algo trading
- **Orchestrator:** Temporal (auditability, exactly-once, polyglot if you want JVM risk libs).
- **Agents:** Pydantic-AI for type-safe risk computations; Claude Agent SDK if you want extended-thinking risk explanations.
- **Pattern:** Deterministic Temporal Workflow drives the risk calc; activities call market-data services, pricing engines, Pydantic-AI agents for narrative explanation. Event history = audit trail.
- **Reference:** TradingAgents (arxiv 2412.20138) defines seven roles (Fundamentals/Sentiment/News/Technical Analyst, Researcher, Trader, Risk Manager) — a useful decomposition template.

### 6.2 Reports & insights
- **Orchestrator:** Temporal (or DBOS for lightweight) — long-running, scheduled, idempotent.
- **Agents:** LangGraph (research → synthesis → critique loop) + LlamaIndex Workflows for RAG; Mastra if TS-first.
- **Pattern:** Temporal cron schedule → fan-out activities for each section → LangGraph agent per section → reduce → render. Use Langfuse to score report quality with LLM-as-a-Judge over time.

### 6.3 Rules-based voice agent
- **Voice transport:** LiveKit Agents (recommended) or Pipecat (better state-machine ergonomics via Pipecat Flows).
- **LLM:** OpenAI Realtime (lowest latency) or STT+LLM+TTS pipeline (Deepgram + Claude + ElevenLabs).
- **Rules backbone:** Temporal Workflow holding conversation state and rule DAG; voice agent signals the workflow on each turn and queries it for the next action.
- **Side effects:** All booking/CRM/payment side-effects as Temporal activities — guarantees idempotency and a full audit trail of every voice interaction (compliance-friendly).

---

## 7. Recommended PoC Plan (8–12 weeks)

| Phase | Weeks | Goals |
|---|---|---|
| 1 — Foundation | 1–2 | Helm-deploy Temporal (Postgres) on K8s; deploy Temporal Web; register first namespace; deploy a hello-world workflow in both Py and TS. **In parallel:** stand up DBOS in a small service to compare DX. |
| 2 — Observability | 3–4 | Helm-deploy Langfuse (Postgres + ClickHouse + Redis + MinIO); instrument a simple Pydantic-AI agent; wire OTel Collector → Tempo + Prometheus + Grafana. |
| 3 — Use case 1 | 5–6 | Build risk-calc workflow: Temporal Workflow → Pydantic-AI activity → market-data service. Validate determinism, replay, audit-trail. |
| 4 — Use case 2 | 7–8 | Build report pipeline: scheduled Temporal cron → LangGraph activity (research → synthesise → critique) → render. Validate cost dashboards in Langfuse. |
| 5 — Use case 3 | 9–10 | Stand up LiveKit Agents on K8s + Pipecat Flows (or coded state machine) for rules; integrate Temporal workflow behind it for side-effects. |
| 6 — Platform-isation | 11–12 | ArgoCD ApplicationSet for tenant onboarding; Worker Controller CRD; per-tenant Langfuse project; cost showback dashboards. |

**Decision point at end of week 4:** Temporal-only vs Temporal+DBOS hybrid (DBOS for simpler in-process services, Temporal for cross-service orchestration).

---

## 8. ASCII Decision Tree

```
                        Need durable orchestration on K8s
                                    │
              ┌─────────────────────┼──────────────────────┐
              │                     │                      │
   Polyglot incl. JVM?     Py/TS only + already      Want lightest binary,
   Need fintech-grade       run Postgres? Want      AI-positioned, can accept
   audit + scale?           time-travel debug?      smaller community?
              │                     │                      │
              ▼                     ▼                      ▼
         TEMPORAL                DBOS                  RESTATE
              │                     │                      │
              └─────────────────────┴──────────────────────┘
                                    │
                                    ▼
              Inside workflow, call narrow agents:
   ┌──────────────────────────────────────────────────────────────┐
   │ Risk calc        → Pydantic-AI activity                      │
   │ Reports/insights → LangGraph activity (+ LlamaIndex for RAG) │
   │ Voice            → LiveKit/Pipecat process                   │
   │                    (signals workflow each turn)              │
   └──────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
              Observe everything via Langfuse + OTel GenAI semconv
                          → Tempo + Prometheus + Grafana
```

---

## 9. Risks & Open Questions

1. **Determinism vs ergonomics tax.** Temporal's strict sandbox is the biggest source of "this should just work" friction with agent code. Mitigation: train one platform engineer deeply on the activity/workflow boundary; provide opinionated starter templates.
2. **DBOS lock-in.** If you go DBOS-primary, you bind to Postgres + Py/TS. Acceptable for two of three use cases; trading systems may want a JVM option later.
3. **Voice latency budget.** End-to-end < 800 ms is the realistic target with LiveKit + Deepgram + GPT-4o + ElevenLabs; OpenAI Realtime gets you closer to 500–600 ms but adds vendor lock-in.
4. **OTel GenAI agentic semconv is still in flux.** Bet on the stable `gen_ai.*` attributes today; expect to refactor agent-trace shapes in 2026–27.
5. **Helm ergonomics for Langfuse.** Five components (Web, Worker, Postgres, ClickHouse, Redis, MinIO) is the heaviest single piece in the stack — budget operator capacity accordingly.

---

## 10. Concrete Component & Link Index

**Durable execution**
- Temporal — https://temporal.io · https://github.com/temporalio/temporal · https://github.com/temporalio/helm-charts
- DBOS — https://www.dbos.dev · https://github.com/dbos-inc/dbos-transact-py · time-travel: https://docs.dbos.dev/typescript/tutorials/debugging
- Restate — https://restate.dev · https://github.com/restatedev/restate
- Hatchet — https://hatchet.run · Inngest — https://www.inngest.com · Prefect — https://prefect.io

**Agent frameworks**
- Pydantic-AI — https://ai.pydantic.dev (DBOS + Temporal integrations documented)
- LangGraph — https://docs.langchain.com/oss/python/langgraph/
- OpenAI Agents SDK — https://openai.github.io/openai-agents-python/
- Mastra — https://mastra.ai
- LlamaIndex Workflows — https://docs.llamaindex.ai
- Claude Agent SDK — https://docs.anthropic.com

**Voice**
- LiveKit Agents — https://docs.livekit.io/agents/ · https://github.com/livekit/agents
- Pipecat — https://www.pipecat.ai · Pipecat Flows — https://github.com/pipecat-ai/pipecat-flows
- OpenAI Realtime — https://platform.openai.com/docs/guides/realtime

**Observability**
- Langfuse — https://langfuse.com · self-host: https://langfuse.com/self-hosting
- Arize Phoenix — https://arize.com/docs/phoenix
- OTel GenAI semconv — https://opentelemetry.io/docs/specs/semconv/gen-ai/

**K8s ops**
- ArgoCD, External Secrets Operator, Karpenter / KEDA, Istio / Cilium for mTLS

---

## 11. Final Recommendation in One Paragraph

Stand up **Temporal** on K8s as the primary durable orchestration backbone (best polyglot, best audit, best K8s story, proven for voice and trading), with a **parallel two-week DBOS PoC** to validate whether your team prefers the lighter Postgres-only model. Build narrow agents in **Pydantic-AI** (Python) and **LangGraph / Mastra** (TS), wire them as Temporal activities or DBOS steps. Use **LiveKit Agents** (or Pipecat with Pipecat Flows for the rules state machine) as the voice transport; keep the rules and side-effects in Temporal workflows behind it. Observe everything through **Langfuse** (self-hosted via Helm) plus **OpenTelemetry GenAI conventions**, fronted by **Grafana + Tempo + Prometheus**. Operationalise the platform via **ArgoCD + Temporal Worker Controller + per-tenant namespacing** — that is the path from your three use cases to the north-star self-serve platform.

---

## 12. PoC #1 Learnings — DBOS in Practice (2026-05-09)

*Learnings from building and running the `poc-dbos-sales` PoC: Node.js / TypeScript, Express + DBOSClient (app server) + DBOS.launch() (worker), SQLite for business data, Postgres for DBOS state.*

### 12.1 What worked well

- **Queue-worker split is clean and natural.** App server (`DBOSClient.enqueue()`) and worker (`DBOS.launch()`) share zero code — only a Postgres system database. Adding a new worker type = new deployment, no restarts to existing services.
- **`@DBOS.step()` retry config is excellent DX.** `{ retriesAllowed: true, maxAttempts: 4, intervalSeconds: 2, backoffRate: 2 }` on the decorator — clean, no try/catch retry logic inside the step. Retries were clearly visible in logs.
- **Workflow-level fallback pattern works.** `try/catch` around the agent step + degraded result write means the workflow always completes as `SUCCESS` — callers always get a usable response even when the agent fails entirely.
- **Application versioning is automatic.** DBOS computes a hash of workflow source code at startup — visible as `[version <hash>]` in logs. Every `tsx watch` file save triggers a new version. This is the foundation for blue-green deploys.
- **`DBOSClient.getWorkflow(id)` is lightweight.** No runtime needed on the server side — just a Postgres read. Clean separation confirmed.
- **`ON CONFLICT DO UPDATE` on the insights write** makes `writeInsights` naturally idempotent — safe to replay on crash without duplicate rows.

### 12.2 Gotchas & surprises

| Gotcha | Impact | Fix |
|---|---|---|
| `DBOSClient.create()` takes a URL string, not an object | Server crashed on startup | Pass `databaseUrl` string directly |
| `DBOSClient.retrieveWorkflow()` requires full DBOS runtime | Server crashed on poll | Use `client.getWorkflow(id)` instead |
| `Queue` is actually `WorkflowQueue` in v2 TS SDK | Import error | `import { WorkflowQueue }` |
| `runAdminServer: false` required | Koa crash on Node 20 | Add to `DBOS.setConfig()` |
| DBOS creates a SEPARATE system DB: `<appdb>_dbos_sys` | Confused about which DB to query | Connect to `dbos_sales_dbos_sys` for workflow state |
| `@DBOS.step()` outputs only persisted for `@DBOS.transaction()` | `operation_outputs` table empty for pure async steps | Expected — step replay re-executes the function; use Postgres steps for true checkpointing |
| `tsx watch` auto-reload changes `application_version` hash | New version = old PENDING workflows not auto-recovered by new version | Expected DBOS versioning behaviour — drain old version pods before removing them |
| `DBOSClient` initialisation runs full DBOS migration check | `migration file failed` warning on every server start | Harmless (tables already exist) — suppress by pinning migration state |

### 12.3 DBOS distributed model — confirmed findings

- **Recovery is executor-scoped without Conductor.** Only the process that started a workflow (`executor_id = worker-<pid>`) recovers it on restart. In K8s, set `DBOS_EXECUTOR_ID` to pod name via Downward API.
- **`FOR UPDATE SKIP LOCKED` is the coordination primitive.** No message broker. Multiple worker replicas poll the same queue; Postgres row locking ensures each job is processed exactly once.
- **Workflow definitions live ONLY in the worker.** App server knows only: queue name (string), workflow class name (string), method name (string). Confirmed in practice.
- **No hot-reload / dynamic registration.** Adding a new workflow type requires worker restart (rolling restart on K8s = zero downtime).
- **`application_version` hash changes on ANY code change.** This is stricter than expected — even adding a log line creates a new version. Plan deployments accordingly.

### 12.4 Revised DBOS assessment (vs research)

| Dimension | Research prediction | Actual finding |
|---|---|---|
| Operational simplicity | ✅ Library + Postgres only | ✅ Confirmed — docker compose up + npm run dev:worker |
| DX / learning curve | Moderate | Lower than expected — decorators feel natural in TS |
| Step-level checkpointing | Postgres-backed | ⚠️ Only for `@DBOS.transaction()`, not plain `@DBOS.step()` |
| Multi-process pickup | Queue-based ✅ | ✅ Confirmed — `WorkflowQueue` enables it |
| Conductor for cross-pod recovery | Cloud-only ❌ | ❌ Confirmed — no self-hosted option |
| Time-Travel Debugger | Unique feature | Not yet tested — next priority |
| Throughput ceiling | Postgres-bound | Not load-tested yet |

### 12.5 Next steps from PoC #1

1. **Swap mock agent for real LLM** (OpenAI GPT-4o via Agents SDK) — validate retry/fallback under real 5xx conditions.
2. **Add Langfuse tracing** around the agent step — wire OTel spans to see LLM latency + cost per workflow.
3. **Test Time-Travel Debugger** (VS Code extension) — replay a production trace locally.
4. **Build PoC #2 — Temporal** with the identical use case for apples-to-apples comparison.
5. **Load test** — run 3 worker replicas, trigger 100 concurrent workflows, observe Postgres queue behaviour.
