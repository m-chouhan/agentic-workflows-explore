# Deterministic-Enough Agentic Workflows: A Three-Mechanism Framework

**Date:** 2026-05-26
**Workspace:** `ai-agent-workflow-explore/`
**Anchor codebase:** `dbos-agentic-platform/` — DBOS v4 + TypeScript + Vercel AI SDK + Gemini 2.5 Flash
**Workflows in scope:** `scanAndFix` (Trivy → triage agent → fix agent → PR), `analyzeYear` (sales rows → aggregate → analysis agent → persist)
**Status:** Research only. No code patches in this report.
**Framing:** Loose-metaphor mapping of three quantum-to-classical mechanisms — *macroscopic averaging*, *decoherence*, *interference engineering* — onto concrete 2024–2026 AI/agent patterns.

---

## Executive Summary

The central philosophy you set is right and supported by every source surveyed: **non-deterministic intelligence layers can be coaxed into deterministic-enough outputs without losing their reasoning power, provided determinism is applied at *every* layer — prompt, call, schema, workflow, and lifecycle.** No single technique is sufficient. Below, the three quantum mechanisms are reframed as a layered engineering stack:

- **Averaging → Sampling-and-aggregation patterns** (self-consistency / N-of-K voting, LLM-as-judge, ensembles) that smooth out per-call noise.
- **Decoherence → Environment isolation** (canonical inputs, pinned model versions, versioned prompts, pinned tools) that prevent silent drift from corrupting "same input" semantics.
- **Interference → Output-space shaping** (provider-side constrained decoding, schema invariants, generate→critique loops) that make wrong outputs impossible at generation time.

On top of these sits a **fourth, workflow-layer**: DBOS's replay-from-step-output already provides *replay determinism*; the open question is **fresh-generation determinism** — handled with idempotency-keyed memoisation, saga-style compensation, and shadow→staged→prod promotion of agent changes.

**Key empirical caveat threaded through every section**: even `temperature: 0` is not bit-exact on cloud models. GPU/batch/MoE-routing non-determinism produces measurable per-call variance regardless of seed. The goal is therefore **logical determinism** — same logical input yields equivalent-enough output under a defined schema — not bit-exact reproducibility.

---

## How to Read This Report

The report is organised thematically (not by research domain). Each theme reads as a unified analysis combining all four research streams:

1. **The Determinism Illusion** — why temp=0 + seed is not enough, and what *deterministic-enough* actually means.
2. **Theme 1 — Averaging**: smoothing per-call noise via sampling, voting, and judging.
3. **Theme 2 — Decoherence**: isolating the LLM call from environmental drift.
4. **Theme 3 — Interference**: shaping the output space so wrong answers are impossible.
5. **Theme 4 — Workflow lifecycle**: layering DBOS replay, memoisation, compensation, and promotion gates.
6. **Per-agent recommendation matrix** for your three agents (`vulnTriageAgent`, `vulnFixAgent`, `salesAnalysisAgent`).
7. **Decoherence audit checklist** (15 items) and **decision tree** for picking a determinism mechanism.
8. **References** (40+ curated URLs).

---

## 0. The Determinism Illusion

Every source converges on the same uncomfortable truth: **`temperature: 0` does not guarantee determinism on cloud-hosted LLMs in 2026**.

- A NeurIPS 2025 study showed that, even at temperature 0 with greedy decoding, changing the number of GPUs, hardware model, or batch size can cause accuracy to fluctuate by as much as 9%. BF16 precision is a "disaster zone" for reproducibility; FP32 reaches near-perfect reproducibility with only ~2.2% sample divergence.
- Gemini 2.5 supports a `seed` parameter and makes a "best effort" to sample deterministically, but the Gemini API has been observed producing non-deterministic outputs with fixed seed on `gemini-2.5-pro` as recently as Sept 2025.
- Anthropic explicitly documents that even at temperature 0.0 results will not be fully deterministic.
- OpenAI: seed + `system_fingerprint` reproduces "mostly", with documented residual variance attributed to inherent model non-determinism.
- MoE architectures introduce a structural source of variance: routing decisions during batching depend on what *other* requests are batched with yours.

**Implication for the report**: we redefine the target from *bit-exact reproducibility* to *logical determinism under a schema*: the output, projected through your Zod schema's discriminative fields, should match across runs. Free-text fields (`summary`, `reasoning`) are treated as best-effort.

This reframe directly informs your philosophy — "non-deterministic system → deterministic outputs while keeping AI intelligence". The leverage is exactly there: pin the *decisions* (fields that drive downstream behaviour) and let the *narration* drift.

---

## 1. Theme 1 — Averaging: Smoothing Per-Call Noise

> *Macroscopic averaging in physics: a million dice produce a predictable mean. The analogue in agents: a small ensemble of LLM calls (or judges) collapses per-call variance into a stable decision.*

### 1.1 Self-Consistency / N-of-K Majority Voting

The foundational pattern (Wang et al. 2022, ICLR 2023; arXiv 2203.11171) samples K reasoning paths at a non-zero temperature and aggregates by plurality on the final answer. It boosts chain-of-thought on GSM8K by +17.9% and SVAMP by +11.0%, and is now a default building block for high-stakes classification.

For **structured outputs** (your case — `TriageResult` has `prioritizedFindings[]` + `recommendedAction`), naive object-level voting falls apart (no two JSON blobs are byte-identical). The 2025 literature recommends:

- **Vote per discriminative field**, not per object. For `TriageResult`, vote on `recommendedAction` (enum), `blockerCount` (mode), and `triage.fixType` per finding ID.
- For arrays, use **rank-aggregation methods**: Borda count, instant-runoff, or mean reciprocal rank (cited in ACL 2025 Findings on structured self-consistency).
- For free-text fields (`executiveSummary`), use **universal self-consistency**: an LLM judge picks the "most representative" of K candidate summaries rather than voting on words.

**Cost**: K× tokens. For Gemini 2.5 Flash on your scan path, K=5 is roughly 5× cost — acceptable for triage (low volume, high stakes), not for the fix agent (called per-finding).

**Efficient variants (2024–2025)**: ESC (Efficient Self-Consistency) and adaptive-K methods reduce average samples by stopping early when the first 2–3 samples already agree.

### 1.2 LLM-as-Judge / Verifier (Single-Call + Discriminator)

Pattern: one generation, then a second LLM (or rule-based check) scores or accepts/rejects against domain invariants. Reflexion (NeurIPS 2023, arXiv 2303.11366) generalises this into a loop that re-prompts with the critique in-context, reaching 91% pass@1 on HumanEval vs GPT-4's 80%.

Three key findings from the 2025–2026 LLM-judge literature:

- **Inter-judge agreement is high but not free.** A well-prompted LLM judge agrees with humans ~85% of the time, often higher than two humans agree with each other on the same task — but only with explicit rubric, position-bias mitigation, and (often) multiple judges combined by max-voting or averaging.
- **Position bias is real**: attention favours tokens at the start and end of context. Put the criteria there, not buried mid-prompt.
- **Judges hurt on rare-failure / high-cost tasks.** A judge catching 80% of hallucinations is great unless the missed 20% is regulatory exposure. Treat the judge as a triage filter, not a final word.

**Rule-based vs LLM judge**: use rule-based code wherever the invariant is expressible (e.g. `blockerCount === prioritizedFindings.filter(f => f.adjustedSeverity === 'critical').length`). Reserve LLM judges for genuinely fuzzy criteria (e.g. "does this fix preserve the original function's behaviour?").

### 1.3 Model Ensembles (Cross-Model Consensus)

Run the same prompt through 2–3 different models (e.g. Gemini + Groq Llama + Claude Haiku) and accept only fields where they agree; escalate disagreements. The 2024–2025 ensemble literature (Crucible Ensemble framework, Collective Decision-Making papers) reports superior accuracy and reduced category inflation versus any single model.

**Cost-benefit**: 3–5× inference cost but parallelisable so latency stays single-call. Best for **discrete fields** (severity, fixType, recommendedAction). Poor fit for **continuous/open-ended fields** (summaries). Worth it for `scanAndFix` decisions that gate auto-PR creation; almost certainly overkill for `analyzeYear`.

### 1.4 What "Averaging" Maps To For Your Agents

| Agent | Averaging mechanism that fits | Reasoning |
|---|---|---|
| `vulnTriageAgent` | **Self-consistency K=5 with field-level voting** + a small rule-based judge for invariants like `blockerCount` | Multi-field judgment with high downstream impact. Cost is bounded by scan frequency, not finding count. |
| `vulnFixAgent` | **Single call + rule-based judge** (syntax-check the patch, run the test suite). Optionally Reflexion loop with K=2 max on patch failure. | Per-finding cost makes K-sampling expensive. Patches are *verifiable* — let the verifier do the averaging. |
| `salesAnalysisAgent` | **None** (single call). The aggregation step already does macroscopic averaging on the *data*. The LLM is narrating, not deciding. | Your own assessment: it's stable. Don't pay for K× tokens on a step where numeric ground-truth is already deterministic. |

---

## 2. Theme 2 — Decoherence: From Quantum Superposition to Classical Action

> *In physics, decoherence is the bridge by which infinite quantum possibilities collapse into a single classical reality. Particles exist in superposition until environmental interaction forces collapse into a definite state. The agent analogue is unusually tight: an LLM naturally generates a superposition of plausible answers; the right architecture deliberately couples that superposition to filtering environments — tools, critics, schemas, real-world data — until it collapses into a single, executable, deterministic plan.*

This is the **central architectural insight** of the report. The first theme (averaging) and the third (interference) are mechanisms; this theme is the **shape of the workflow** that uses them. Every agentic feature you build should pass through three phases, in this order.

### 2.1 The Three-Phase Pattern

```
┌────────────────────┐    ┌────────────────────┐    ┌────────────────────┐
│   1. SUPERPOSITION │ →  │   2. DECOHERENCE   │ →  │  3. CLASSICAL      │
│   (Exploration)    │    │   (Selection)      │    │     STATE          │
│                    │    │                    │    │   (Execution)      │
│ LLM generates a    │    │ Candidates couple  │    │ Single committed   │
│ wide set of        │    │ to filtering       │    │ plan executes      │
│ divergent          │    │ environments;      │    │ deterministically  │
│ candidate plans /  │    │ unviable ones      │    │ under DBOS         │
│ strategies /       │    │ decay; survivors   │    │ replay,            │
│ hypotheses         │    │ are ranked         │    │ idempotency,       │
│                    │    │                    │    │ saga compensation  │
│ NON-DETERMINISTIC  │    │ MOSTLY DETERMINIST │    │ FULLY DETERMINISTIC│
└────────────────────┘    └────────────────────┘    └────────────────────┘
       ▲                          ▲                          ▲
       │                          │                          │
   Probabilistic              Engineered               Classical world:
   substrate; let              measurement              DBOS, Postgres,
   the LLM be the              apparatus                git, PRs
   LLM
```

The discipline at each boundary is what makes this work. **Phase 1 must not commit early.** **Phase 2 must use deterministic-or-near-deterministic filters** (otherwise you're stacking noise on noise). **Phase 3 must never re-open the superposition** (otherwise the workflow loses replay safety).

### 2.2 Phase 1 — Superposition (Exploration)

The agent deliberately holds **many candidate strategies simultaneously**, none committed to. This is the LLM in its natural state — sampling broadly across the possibility space. The discipline: persist all candidates, do not pick one yet.

Concrete techniques from the 2023–2026 literature that implement Phase 1:

- **Tree of Thoughts** (Yao et al. 2023, NeurIPS) — branch reasoning into a tree of hypotheses
- **Self-Consistency K-sampling** (Wang et al. 2022) — sample K reasoning paths in parallel
- **Plan-and-Solve / multi-plan generation** — explicitly ask the model for N divergent approaches
- **Branch-and-Solve-Merge** (Anthropic 2024) — explicit divergent branching for complex prompts
- **Persona variation across K calls** — "approach as a pessimist", "as a minimalist", "as a maximalist" — forces structurally different candidates instead of near-duplicate wording

**Diversity preservation matters.** A bad Phase 1 generates K candidates that are minor rewordings of the same underlying strategy — the superposition collapses trivially. Mix temperatures across the K samples, vary personas, and inspect candidate edit-distance to detect mode-collapse early.

### 2.3 Phase 2 — Decoherence (The Selection Filter)

This is where engineered environmental coupling **causes weaker candidates to decay** while stronger ones survive. The "environment" is whatever real-world signal you can bring to bear:

| Filter source | What it decoheres | Determinism |
|---|---|---|
| **Real-world API data** | Candidates whose assumptions don't match reality | Fully deterministic on data snapshot |
| **Tool / sensor feedback** (`git apply --check`, `tsc --noEmit`, test runs, `npm install --dry-run`) | Candidates the codebase physically rejects | Fully deterministic on pinned env |
| **Schema constraints** (`responseSchema` + Zod `.superRefine`) | Wrong-shape or invariant-violating candidates | Fully deterministic |
| **Critic agents (LLM-as-judge)** | Candidates below a quality threshold | Near-deterministic with self-consistency |
| **Cross-candidate consistency** | Candidates that disagree with the majority | Deterministic aggregation |
| **Cost / policy constraints** | Over-budget or non-compliant candidates | Fully deterministic |
| **Human-in-the-loop** | Whatever the human rejects | Externally deterministic |

**Run filters in cascade — cheapest, most-discriminating first**:

```
K=20 candidates
    ↓ cheap deterministic (schema, syntax)   → 8 survive
    ↓ medium (tool calls, static analysis)   → 3 survive
    ↓ expensive (LLM critic, ensemble vote)  → 1 survives
```

**A filter is only as good as the stability of its inputs.** A critic LLM that scores candidates against a prompt that itself drifts is a noisy measurement device. Hence the *traditional* decoherence-isolation patterns (the ones in earlier drafts of this section) live *inside* Phase 2 as input-stabilising disciplines — they make the measurement apparatus itself reliable:

1. **Input canonicalisation** — RFC 8785 JSON Canonicalization Scheme (JCS) for any JSON inlined in critic prompts. Sorted keys, deterministic float serialisation, no duplicate keys. `json-canonicalize` in TypeScript. Strip timestamps and request IDs before serialising. Sort arrays with no semantic ordering. Quantise floats to domain-appropriate precision.
2. **Model & SDK version pinning** — pin Gemini to explicit `gemini-2.5-flash` (never `*-latest`); set `temperature` explicitly on every call; log `system_fingerprint` / response metadata to detect silent backend changes; prefer dated snapshots (`gpt-4o-2024-08-06` style) where the provider offers them.
3. **Prompt versioning** — prompts live in a `prompts/` directory as data, not inline strings. Each file carries `version`, `model`, `temperature` metadata. Hash the body and persist the hash with every result. Tools: Langfuse (open-source, MIT, supports Vercel AI SDK), Promptfoo (declarative YAML in CI, used internally by OpenAI and Anthropic), Braintrust (SaaS, eval-loop-centric). Promptfoo is the lightest entry point — one `promptfooconfig.yaml`, caches LLM calls between runs, plugs into GitHub Actions.
4. **Tool / external-environment pinning** — Trivy with `--skip-update` and a pre-baked CVE DB in the Docker image; `npm audit` baselined and diffed (detect *new* CVEs, not registry churn); GitHub Actions pinned to full commit SHA, never tag (the March 2026 Trivy supply-chain incident is the canonical case); repo clones at full commit hash, never branch.

These four sub-disciplines are no longer the *theme* — they are the **calibration layer** that makes Phase 2 filters trustworthy. Skip them and your decoherence step is itself decohering randomly.

### 2.4 Phase 3 — Classical State (Execution)

The surviving candidate is now a **structured, linear, deterministic action plan**. From this boundary forward, the workflow behaves classically: same plan, same execution, every replay. DBOS takes over.

The transition contract:

- Phase 1 output: a *set* of candidates
- Phase 2 output: a *ranked, filtered* set with scores
- Phase 3 input: a *single* plan — frozen, schema-validated, hashed, persisted
- Phase 3 execution: deterministic DBOS workflow — replay-safe, idempotent, saga-compensable

The "collapse" is the *boundary* between the agentic (probabilistic) front-end and the workflow (deterministic) back-end. Once across, the only allowed sources of variation are *failure paths* (retries, compensation, escalation) — never fresh LLM generation. If a Phase 3 step fails in a way that demands re-thinking, the entire workflow re-enters Phase 1 under a new workflow ID, not in-place.

### 2.5 Patterns This Unlocks

- **Generator / Filter / Executor triad** — every new agentic feature decomposes into these three layers. The PRD answers: *what's the superposition, what filters cause decoherence, what's the classical execution?*
- **Soft collapse vs hard collapse** — hard collapse picks one and discards the rest; soft collapse keeps top-N as a weighted ensemble and surfaces confidence downstream (e.g. PR proposes Plan A but the description notes Plan B as a secondary option). Soft collapse is the agentic version of *measurement with uncertainty quantification*.
- **Re-superposition on filter failure** — if Phase 2 decoheres *all* candidates, re-prompt with filter feedback ("none of the 5 plans worked because X") and generate a new K. This is Reflexion expressed in quantum language: failed measurement → re-prepare the superposition → measure again. Cap at ≤ 2 re-superpositions to bound cost.
- **Ground-state fallback** — always define a deterministic fallback ("if nothing survives, label PR `needs-human-review`"). The system *always* reaches a classical state; it never hangs in superposition.
- **Phase-1 diversity audits** — periodically compute pairwise edit-distance across the K candidates from a given prompt. If the mean drops below a threshold, the prompt has mode-collapsed and needs a diversity revision.

### 2.6 What This Maps To For Your Agents

| Agent | Today | Reframed under Superposition → Decoherence → Classical |
|---|---|---|
| `vulnFixAgent` | Collapses too early: picks a strategy *while* generating the patch. Single shot, no exploration. | **Phase 1**: generate K=5 fix strategies (bump-all / bump-direct / replace / pin+override / defer-non-critical). **Phase 2**: `npm install --dry-run`, re-scan with Trivy, critic agent scores. **Phase 3**: apply patch → run tests → open PR under DBOS replay. |
| `vulnTriageAgent` | Single classification, schema-validated. Decision quality entirely depends on one LLM call. | **Phase 1**: K=5 triage samples at moderate temperature. **Phase 2**: field-level voting (per-finding `fixType` mode; `blockerCount` invariant check). **Phase 3**: persist single committed `TriageResult` for downstream `vulnFixAgent`. |
| `salesAnalysisAgent` | Already partly Phase 3: aggregation collapses raw rows into classical `AggregatedSales` before the LLM sees them. Single narration call. | **Phase 1**: K=3 candidate analyses with different angles (growth / risk / cohort). **Phase 2**: numeric-grounding check (each claimed number must round-trip to the aggregation) + critic for stakeholder fit. **Phase 3**: persist + render + publish. The angle diversity adds value without sacrificing today's stability — every surviving candidate is still numerically grounded. |

### 2.7 Why This Maps So Cleanly To DBOS

DBOS is **architecturally suited** to the Phase 2 → Phase 3 transition.

- Phase 1 + Phase 2 happen inside an `agentic-planner` step (or a small group of steps) that returns *one* committed plan.
- That plan is persisted by DBOS as step output — **the collapse becomes durable**.
- Phase 3 is a deterministic child workflow whose steps are derived mechanically from the plan.
- On replay, DBOS reads the *collapsed* plan from storage — Phase 1 and Phase 2 are never re-run. Replay is purely classical.

This is a clean architectural separation: **probabilistic reasoning lives in *one* boxed step**, deterministic execution lives in every other step. The "quantum-classical boundary" is a literal line in your code, and DBOS makes that line load-bearing.

### 2.8 The Punchline

> **Decoherence is not the enemy of agent determinism — it is the mechanism by which agent determinism is *manufactured* from probabilistic LLM substrate.**

Just as classical physical reality emerges from quantum substrate via decoherence in the universe, **classical (deterministic, executable) action plans emerge from LLM-generated superposition via *engineered* decoherence in your agent stack.**

The job of an agent architect is to:

1. **Open** a superposition wide enough to find good answers (Phase 1)
2. **Engineer** decoherence filters strong enough — and stable enough — to collapse to *the* right one (Phase 2)
3. **Hand off** the survivor to a classical execution layer (Phase 3) where DBOS, replay, idempotency, and saga compensation reign

The averaging mechanisms of §1 *populate* Phase 1 and *staff* Phase 2's critic filters. The interference mechanisms of §3 *implement* Phase 2's schema and constrained-decoding filters. The workflow lifecycle of §4 *guards* the Phase 3 boundary. This theme is the architecture; the other themes are the components.

---

## 3. Theme 3 — Interference: Building Reliable Systems From Unreliable Parts

> *Physics inspiration: quantum computers don't fight randomness — they arrange wave amplitudes so correct answers reinforce and wrong answers cancel. The deeper engineering precedent is older and closer to home: every reliable system we have ever built — from CPUs to distributed databases to airline flight controls — is made of unreliable parts arranged in topologies where their failures cancel. This section is about that topology, applied to agents.*

The first two themes are about *what happens inside one LLM call*. This theme is about **architecture**: how you compose multiple unreliable agents into a system whose output is reliable. The pattern is generic and travels across domains — your `scanAndFix` and `analyzeYear` workflows are just two instances of it.

### 3.1 The Engineering Lineage

Software engineering already knows how to build reliability from unreliable parts. The pattern has many names depending on the layer:

| Discipline | Pattern | What it does |
|---|---|---|
| Distributed systems | **Quorum / consensus** (Raft, Paxos) | Multiple unreliable replicas vote; majority wins |
| Storage | **Erasure coding, RAID** | Data + parity spread across drives; any subset can reconstruct |
| Networking | **Forward error correction, TCP retransmit** | Add redundancy / feedback so noisy channels carry clean bits |
| Microservices | **Circuit breakers, bulkheads, timeouts** | Isolate failures so one bad component doesn't take the system down |
| Code quality | **Code review, adversarial testing, fuzzing** | Pair every author with a structurally-incentivised critic |
| ML systems | **Ensembling, boosting, bagging** | Many weak learners combined outperform any single strong one |
| Hardware | **Differential signalling, push-pull amplifiers** | Pair every signal with its inverse so common-mode noise cancels |

The shared insight: **reliability is a property of the topology, not the components.** No single Raft node is reliable enough to run your bank; the *arrangement* of nodes is. Agents follow the same rule.

### 3.2 The Architecture Pattern

For agents, the pattern reduces to three layers:

```
            ┌──> Reasoner A  (frame 1) ──┐
            ├──> Reasoner B  (frame 2) ──┤
[Input] ──> │                            ├──> [Aggregator] ──> [Decision]
[FAN-OUT]   ├──> Reasoner C  (primary) ──┤  (deterministic,    (single,
            └──> Critic    (adversary) ──┘   schema-bound)      committed)
```

Three load-bearing components, each generic:

#### 1. Fan-out (input expansion)
Take the input and produce N **structurally different** variations — different reasoning frames, different personas, different model families, different constraints. The discipline word is *orthogonality*: variations whose failure modes are independent. If the variations all share the same blind spot, the aggregator can't see past it. This is the same reason a Raft cluster co-locates its replicas in *different* availability zones, not the same rack.

#### 2. Parallel reasoning — primary agents and critics
Two roles run in parallel:

- **Primary reasoners** — diverse frames, asked to *produce* a candidate answer.
- **Critics (adversarial agents)** — paired with primaries, asked to *attack* the candidate: find counterexamples, surface failure modes, simulate worst-case usage, look for hallucinations.

The combination is what matters. Primaries alone reduce to majority voting (smooths random noise only). Critics alone reduce to a gatekeeper (single point of failure, easily wrong). Together they form the agent equivalent of a code-review process: someone writes, someone breaks; the merged decision is stronger than either.

Most current agent stacks are *monocultures of optimists* — every component is rewarded for plausibility, none is rewarded for breaking things. Introducing a structurally-incentivised critic is the single biggest reliability lever available at the architecture level.

#### 3. Aggregator → Decision (deterministic collapse)
A final component, **not an LLM**, that:

- Extracts structured anchors from each primary's output (numbers, enums, named entities, decisions — *not* free text)
- Weights them by cross-primary agreement (more agreement → higher weight)
- Subtracts weight where a critic has surfaced an unrefuted attack
- Applies a confidence threshold; below it, escalates instead of guessing

This is the agent equivalent of the *commit phase* in a two-phase commit, the *decision* in a consensus protocol, or the *final classifier* on top of an ML ensemble. It is intentionally dumb: classical code, deterministic, auditable, no surprises.

### 3.3 The Two Principles That Make the Pattern Work

**Principle 1 — Orthogonal diversity.** Diversity that shares a failure mode is anti-redundant: it gives an aggregator false confidence. The hard engineering question for any fan-out is "what failure does each branch *not* have that the others do?". Different prompts of the same model is the weakest form of diversity. Different reasoning frames is stronger. Different models is stronger still. Different *modalities* (LLM + symbolic checker + tool feedback) is strongest.

**Principle 2 — Adversarial pairing.** Every "do" should be structurally paired with a "don't". Double-entry bookkeeping survives because every credit has a corresponding debit. Code merges survive because every author has a reviewer. Agent outputs survive scale because every primary has a critic. The pairing isn't optional polish — it is what converts plausibility into correctness.

### 3.4 Where to Apply the Pattern

This is an architecture pattern, not a tactic — so the decision is *which agentic steps deserve it*, not *which library to use*. A useful heuristic:

| Step type | Apply the full pattern? |
|---|---|
| One-shot classification with clear ground truth | No — a single call + schema check is enough |
| Open-ended judgement that gates downstream action | **Yes** — diversity + adversarial critic + dumb aggregator |
| Generation that can be verified by a tool (compile, test, lint) | Partial — single primary + tool-as-critic is sufficient |
| High-stakes irreversible action (auto-merge, payment, send email) | **Yes, with human-in-loop as final critic** |
| Cheap, high-volume operations | No — cost dominates; use simpler patterns |

Mapping back to your two workflows as illustrative examples (not the focus): triage and fix-strategy selection are judgement steps that gate downstream action, so they earn the full pattern; patch *generation* has a deterministic critic available (the test suite) so a lighter version fits; the sales narration step has a clear ground-truth check (numbers must round-trip to the aggregation) and doesn't need the full topology.

### 3.5 How This Composes With §1, §2, §4

This theme is **the internal structure of Phase 2** from the §2 architecture, applied whenever the decoherence filter is itself a judgement rather than a deterministic check:

- §1's K-sampling is *one* fan-out strategy (cheap, weak diversity). Persona / model / frame variation is a stronger version of the same idea.
- §2 says "Phase 2 is where candidates decohere." This theme says "when Phase 2's filter is a judgement, build it as primaries + critics + dumb aggregator."
- §4 (next) is how the final committed decision survives in production: idempotency, replay, staged rollout.

So the four themes form a stack:

```
§2  Architecture       (Superposition → Decoherence → Classical)   <-- shape of the workflow
§3  Interference       (Primaries + Critics + Aggregator)          <-- shape of each judgement step
§1  Averaging          (K-sampling, voting, judges)                <-- components inside §3
§4  Lifecycle          (DBOS, idempotency, rollout)                <-- how it survives in production
```

### 3.6 The Generic Engineering Lessons

For a lead engineer building any agent system, the transferable rules:

1. **Reliability is a topology property.** Don't ask "is this agent reliable?" — ask "is this arrangement reliable?"
2. **Diversity must be orthogonal to be useful.** Correlated failures amplify in aggregators; uncorrelated failures cancel.
3. **Pair every producer with a structurally-incentivised critic.** Monocultures of optimists fail in correlated, hard-to-debug ways at scale.
4. **The final decision should be deterministic, dumb, and auditable.** If an LLM is your final aggregator, you have not built a deterministic system.
5. **Fail closed, escalate explicitly, never guess silently.** A "low confidence, escalating" signal is correct behaviour, not a regression.
6. **Apply the pattern only where it earns its cost.** Open-ended judgement that gates action — yes. Cheap high-volume classification — no.

### 3.7 The Punchline

We already know how to build reliable systems from unreliable parts — Raft, RAID, ensembles, code review, redundant flight controls. Agents don't need a new theory; they need the **same topology discipline** applied to a new class of unreliable component. The interference pattern (fan-out into orthogonal reasoners, pair every primary with a critic, collapse with a dumb deterministic aggregator) is the generic shape. The specifics — which reasoning frames, which critics, which aggregation rules — are the per-domain customisation. The architecture itself is universal.

---

## 4. Theme 4 — Workflow Lifecycle: Layering DBOS Replay, Memoisation, Compensation, and Promotion

> *DBOS already gives you replay determinism (persisted step outputs). The unsolved problem is what happens on the **fresh-generation path**: first-time runs, retries-with-different-output, prompt/model upgrades.*

### 4.1 Idempotency & Memoisation

DBOS guarantees each step executes effectively exactly-once: on workflow replay, persisted step outputs are returned instead of re-executing. For LLM steps, this means a re-played workflow always sees the *same* LLM answer — replay determinism by construction.

For *cross-workflow* memoisation (two different workflow IDs asking the same question), layer an application-level cache inside the LLM step:

```
idempotency_key = hash(
  canonical_prompt_bytes      // RFC 8785 JCS
  + prompt_template_version    // hashed prompt file
  + model_id                   // e.g. "gemini-2.5-flash"
  + schema_hash                // hashed Zod schema
  + temperature
)
```

Cache backends in the 2026 ecosystem:

- **Anthropic prompt caching** (server-side, `cache_control: { type: 'ephemeral' }`): documented ~90% cost / ~85% latency reduction on long prompts. Cache reads $0.30/M vs $3.00/M write. 5-minute lifetime, extends to 1 hour with regular hits. Break-even at ~2 hits per cached prefix.
- **Application-level semantic cache**: GPTCache, LangChain `RedisSemanticCache` — embedding-based, returns cached response when query similarity > threshold.
- **Local exact-match cache**: a Postgres table keyed by the idempotency hash above; trivial and free in your stack.

Trade-off to be deliberate about: memoisation is the *opposite* of fresh generation. If your reason for retrying is "the previous output was bad", caching just returns the same bad output. The retry path must be a *different* idempotency key (e.g. include a `retry_attempt` field in the hash).

### 4.2 Saga-style Compensation for Output Divergence

DBOS doesn't have a built-in saga primitive but composes one cleanly. Two reminders from the DBOS skill in your repo:

- **Steps have unique names per invocation.** A retry that should generate a *fresh* answer must use a different step name (`analyzeLLM_retry1`), otherwise DBOS replays the persisted output and you never get a new generation.
- **Compensations must be idempotent.** The compensation may run even if the "thing to compensate" partially executed.

Sketch for a validate-and-regenerate path:

```typescript
let result = await DBOS.runStep(() => llmCall(input), { name: 'analyze' });
const valid = await DBOS.runStep(() => validate(result), { name: 'validate' });
if (!valid.pass) {
  result = await DBOS.runStep(
    () => llmCall(input, { feedback: valid.reason }),
    { name: 'analyze_retry1' },
  );
}
```

### 4.3 Promotion Pattern: Shadow → Staged → Prod

Shipping a prompt or model change is a deploy, not a config tweak. The 2024–2026 pattern is:

1. **Dev**: write/update Promptfoo eval suite. Require ≥95% pass on golden dataset before PR can merge.
2. **Shadow**: run new prompt/model alongside the current one on real traffic; log `(input, v1_out, v2_out, divergence_score)`; **do not act on v2's output**. 1–7 days. Catches obvious distribution shifts.
3. **Staged rollout** behind a feature flag: 5% → 20% → 50% → 100%, each gated on eval pass-rate not regressing > 2% vs baseline. Auto-rollback on breach (e.g. LaunchDarkly + Langfuse metrics).
4. **Prod**: cache hits serve repeated queries, DBOS replay handles transient failures, divergence metrics continue to flow to observability.

### 4.4 Lifecycle Diagram

```
┌─────────┐    ┌────────────┐    ┌───────────────┐    ┌─────────────┐
│   DEV   │ →  │  SHADOW    │ →  │ STAGED ROLLOUT│ →  │    PROD     │
│         │    │            │    │               │    │             │
│ Golden  │    │ v1 acts,   │    │ 5→20→50→100 % │    │ Cache hits  │
│ tests   │    │ v2 logged  │    │ behind flag,  │    │ + DBOS      │
│ + Zod   │    │ divergence │    │ eval-gated    │    │ replay      │
│ schema  │    │ score      │    │ auto-rollback │    │ + eval on   │
│ CI gate │    │            │    │               │    │   traces    │
└─────────┘    └────────────┘    └───────────────┘    └─────────────┘
     ↑              ↑                    ↑                   ↑
   Promptfoo     Langfuse           LaunchDarkly         Langfuse +
   eval suite    divergence         + eval gate          alerting
                 logging
```

### 4.5 Mapping the Layers Back to the Three Mechanisms

| Quantum mechanism | Workflow-layer realisation |
|---|---|
| Averaging | DBOS step retries with different `name` keys + self-consistency across them; eval-aggregated metrics over many runs |
| Decoherence | DBOS persists `(prompt_hash, model_id, fingerprint)` per step — drift becomes a *query*, not a guess |
| Interference | Validation step after every LLM step; rejection → saga compensation → regenerate-with-feedback |

---

## 5. Per-Agent Recommendation Matrix

| | **`vulnTriageAgent`** | **`vulnFixAgent`** | **`salesAnalysisAgent`** |
|---|---|---|---|
| Averaging | **Self-consistency K=5, field-level voting** on `recommendedAction` + per-finding `fixType`. Rule-based judge for `blockerCount` invariant. | Single call + **rule-based judge** (lint/parse/tests). **Reflexion K=2** on validator failure. | None — single call. Aggregation already averages the data. |
| Decoherence | Canonicalise findings JSON (sort by `id`, strip timestamps). Pin Gemini version. Log `system_fingerprint`. Move prompt to `prompts/triage.md`. | Canonicalise inputs; pin model; move prompt to `prompts/fix.md`; **pin Trivy DB snapshot per scan**. | Pin model + prompt file. Already stable thanks to aggregation. |
| Interference | Confirm `responseSchema` is being passed through. Add `.superRefine` for `blockerCount` invariant + enum tightening on `fixType`. | Add `.superRefine`: `originalCode` substring of file; `newDependencies` keys ⊆ known package names. **Reflexion-lite on validator failure.** | Add `.superRefine`: `topProduct ∈ data.byProduct.map(...)`. `highlights.length ≥ 3`. |
| Workflow lifecycle | Idempotency cache keyed on canonical findings hash. Shadow new prompts/models. | Idempotency cache per-finding hash. Saga: on validator failure, regenerate under a unique step name. | Idempotency cache per `(year, model, prompt_hash)`. |
| Cost ceiling | ≤5× tokens per scan. Bounded by scan frequency, not finding count. | ≤2× tokens per finding (only when validator fails). | 1× tokens. |

---

## 6. Decoherence Audit Checklist (15 items)

Run this against the existing `dbos-agentic-platform` codebase. Each item is binary pass/fail.

1. ☐ Prompt input JSON canonicalised via RFC 8785 (`json-canonicalize`).
2. ☐ Timestamps / requestIds / scanDates stripped from prompt inputs.
3. ☐ Arrays with no semantic ordering are sorted before serialising.
4. ☐ Floats quantised to domain-appropriate precision.
5. ☐ `GOOGLE_MODEL` is explicit (`gemini-2.5-flash`), never `*-latest`.
6. ☐ `temperature` explicitly set on every LLM call (not left to SDK default).
7. ☐ `system_fingerprint` / model metadata logged with every LLM call.
8. ☐ Prompts live in `prompts/` directory as data, with `version` field.
9. ☐ Prompt body hash persisted alongside each workflow result.
10. ☐ Golden eval suite (`promptfooconfig.yaml`) runs in CI; merge blocked on >5% pass-rate regression.
11. ☐ Trivy run with `--skip-update`; DB snapshot pinned (in Docker image build).
12. ☐ `npm audit` results baselined; comparison detects *new* CVEs only.
13. ☐ GitHub Actions pinned to full commit SHAs, not tags.
14. ☐ Repo clones use full commit hashes.
15. ☐ Drift alert: if `system_fingerprint` changes or golden-test pass-rate drops >2%, an alert fires.

---

## 7. Decision Tree: Which Mechanism for Which Failure Mode?

```
Is the output wrong-shape?  ────────────────────────→  Provider-side responseSchema (interference §3.1)
Is the output right-shape but violates a business rule? → Zod .superRefine (interference §3.2)
Is the output non-reproducible across runs?
  ├─ Same input bytes? ────→ Canonicalise (decoherence §2.1)
  ├─ Same model?        ────→ Pin version (decoherence §2.2)
  └─ Same prompt?       ────→ Versioned prompt files (decoherence §2.3)
Is the LLM giving inconsistent decisions?
  ├─ Decision field is discrete? ──→ Self-consistency K=5 (averaging §1.1)
  └─ Decision needs justification? → LLM-as-judge / Reflexion (averaging §1.2)
Is the output verifiable (syntax, tests, schema)?
  └────────────────────────────────→ Generate → critique → regenerate (interference §3.3)
Is downstream impact catastrophic (security PR auto-merge)?
  └────────────────────────────────→ Add cross-model ensemble (averaging §1.3)
Is the same question asked repeatedly?
  └────────────────────────────────→ Idempotency-keyed cache (lifecycle §4.1)
Are you shipping a prompt or model change?
  └────────────────────────────────→ Shadow → staged → prod (lifecycle §4.3)
```

---

## 8. References

### Determinism fundamentals
- Determinism at temp 0 — overview: https://www.vincentschmalbach.com/does-temperature-0-guarantee-deterministic-llm-outputs/
- NeurIPS 2025 GPU non-determinism: https://medium.com/@zljdanceholic/the-illusion-of-determinism-why-fixed-seeds-cant-save-your-llm-inference-2cbbb4a021b5
- OpenAI seed + `system_fingerprint` cookbook: https://cookbook.openai.com/examples/reproducible_outputs_with_the_seed_parameter
- Anthropic temperature notes: https://docs.anthropic.com/en/api/messages
- Gemini config reference: https://firebase.google.com/docs/ai-logic/model-parameters

### Averaging / sampling
- Self-Consistency paper (Wang et al. 2022): https://arxiv.org/abs/2203.11171
- Structured self-consistency / ranked voting (ACL 2025 Findings): https://aclanthology.org/2025.findings-acl.744.pdf
- Reflexion (NeurIPS 2023): https://arxiv.org/abs/2303.11366
- LLM-as-judge guide (Evidently AI): https://www.evidentlyai.com/llm-guide/llm-as-a-judge
- LLM ensemble framework (Crucible): https://github.com/North-Shore-AI/crucible_ensemble

### Decoherence / context isolation
- RFC 8785 (JSON Canonicalization Scheme): https://www.rfc-editor.org/rfc/rfc8785
- `json-canon` / JCS reference impl: https://github.com/lattice-substrate/json-canon
- Anthropic prompt caching: https://www.anthropic.com/news/prompt-caching
- Vercel AI SDK 5 release notes: https://vercel.com/blog/ai-sdk-5
- LLM model drift detection: https://stackpulsar.com/blog/llm-model-drift-detection/
- Toggle OpenAI determinism: https://lakefs.io/blog/toggle-openai-model-determinism/
- Trivy supply-chain incident analysis: https://socket.dev/blog/trivy-under-attack-again-github-actions-compromise/
- Aqua Security post-mortem: https://www.aquasec.com/blog/trivy-supply-chain-attack-what-you-need-to-know/
- Prompt versioning best practices: https://dev.to/kuldeep_paul/mastering-prompt-versioning-best-practices-for-scalable-llm-development-2mgm

### Interference / output shaping
- Gemini structured output (official): https://ai.google.dev/gemini-api/docs/structured-output
- OpenAI structured outputs (official): https://platform.openai.com/docs/guides/structured-outputs
- Zod docs (.refine / .superRefine): https://zod.dev/api
- XGrammar paper / blog: https://blog.mlc.ai/2024/11/22/achieving-efficient-flexible-portable-structured-generation-with-xgrammar
- vLLM structured outputs: https://docs.vllm.ai/en/v0.8.2/features/structured_outputs.html
- Outlines (dottxt-ai): https://github.com/dottxt-ai/outlines
- JSONSchemaBench (constrained decoding survey, 2025): https://arxiv.org/abs/2501.10868
- Self-Refine (OpenReview): https://openreview.net/pdf?id=S37hOerQLB
- Constitutional AI (Anthropic): https://arxiv.org/abs/2212.08073
- zod-gpt self-correction: https://github.com/dzhng/zod-gpt
- Vercel AI SDK docs: https://ai-sdk.dev/docs/ai-sdk-core/settings

### Workflow lifecycle
- DBOS docs (TypeScript workflows): https://docs.dbos.dev/typescript/tutorials/workflow-tutorial
- DBOS architecture: https://docs.dbos.dev/architecture
- DBOS durable agents (Databricks blog): https://www.dbos.dev/blog/building-durable-agents-dbos-databricks
- Supabase x DBOS: https://supabase.com/blog/durable-workflows-in-postgres-dbos
- Temporal saga pattern (for contrast): https://temporal.io/blog/saga-pattern-made-easy
- Langfuse (open-source LLM observability): https://langfuse.com/docs
- Promptfoo (eval framework): https://www.promptfoo.dev/
- Braintrust: https://www.braintrust.dev/
- LLM feature flags / safe rollouts: https://medium.com/@2nick2patel2/llm-feature-flags-in-backends-policy-driven-prompts-and-safe-rollouts-9b8361ca4479
- LLM shadow traffic / A-B testing: https://www.codeant.ai/blogs/llm-shadow-traffic-ab-testing
- Prompt caching infra guide: https://introl.com/blog/prompt-caching-infrastructure-llm-cost-latency-reduction-guide-2025
- GPTCache: https://github.com/zilliztech/GPTCache

---

## 9. Closing Summary (Bullets)

- **The three quantum mechanisms map cleanly onto three engineering layers** — averaging (sampling/voting), decoherence (isolation), interference (output shaping) — *plus a fourth workflow layer* (DBOS replay + memoisation + compensation + promotion).
- **No single mechanism is sufficient.** The philosophy you set — determinism on every layer — is exactly what the field has converged on.
- **Bit-exact determinism is not the goal.** Logical determinism under a schema is. Pin the decisions, let the narration drift.
- **Biggest free win available today**: confirm/enable provider-side `responseSchema` everywhere and add `.superRefine` cross-field invariants. Both work *with* your existing Vercel AI SDK + Zod setup.
- **Highest-leverage discipline win**: move prompts out of code into versioned `prompts/` files, add a Promptfoo golden suite in CI, log `system_fingerprint` on every call.
- **Pattern that buys back the most observability**: log `(prompt_hash, model_id, system_fingerprint, schema_hash)` with every LLM step. Drift becomes a query, not a guess.
- **Sequencing for your two workflows**: enable §3.1 + §3.2 this sprint; add §2.1 + §2.3 + §2.4 next; layer §1.1 on `vulnTriageAgent` and §3.3 on `vulnFixAgent` after baseline metrics are in; the lifecycle promotion gates (§4.3) come last but pay for themselves the first time you ship a prompt change.

