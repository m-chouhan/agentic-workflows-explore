# Vulnerability Fix Pipeline Architecture — Research Index

**Research Completion Date:** May 10, 2026  
**Research Duration:** ~18 iterations (1.5 hours)  
**Research Direction:** Bottom-up (concrete patterns → architectural insights)  
**Confidence Level:** HIGH

---

## Documents in This Research

### 1. **VULNERABILITY_FIX_PIPELINE_SUMMARY.md** (8.4 KB) ⭐ START HERE
**Purpose:** Quick reference guide answering all 12 research questions  
**Audience:** Decision makers, architects, team leads  
**Contents:**
- Your 12 questions answered in 1–2 paragraphs each
- Architecture decision table (8 key decisions)
- Implementation roadmap (4 phases)
- Key metrics to track
- Critical success factors

**Read time:** 5–10 minutes

---

### 2. **vulnerability-fix-pipeline-architecture-2026-05-10.md** (47 KB, 1326 lines) 📘 DEEP DIVE
**Purpose:** Comprehensive technical architecture document  
**Audience:** Engineers, DBOS implementers, security architects  
**Contents:**
- **Section 1:** Ideal workflow (ASCII diagram + decision points)
- **Section 2:** Deterministic vs agentic classification
- **Section 3:** Human-in-the-loop gate patterns (with code examples)
- **Section 4:** Fix validation strategies (3-layer approach)
- **Section 5:** Rollback patterns and triggers
- **Section 6:** Existing platforms analysis (Snyk, Mend, GitHub Advanced Security)
- **Section 7:** Parallel vs sequential fix trade-offs
- **Section 8:** Transitive dependency resolution algorithms
- **Section 9:** State persistence (DBOS + database schema)
- **Section 10:** DBOS v4 specific mappings (determinism rules, loop naming, parallelism)
- **Section 11:** Security guardrails (prompt injection, supply chain attacks, code execution)
- **Section 12:** Open-source reference implementations
- **Section 13:** Architectural decision summary
- **Section 14:** Implementation phases (MVP → Optimization)
- **Appendix:** Workflow step reference table

**Read time:** 45–60 minutes (or skim sections by topic)

---

## Research Methodology

### Sources Consulted
1. **Atlassian Internal:**
   - Snyk automation pilot (Q2 FY2026) — real-world metrics
   - Bitbucket Agentic Pipelines documentation
   - AMS Vulnerability Intelligence Report (Q1 2026)
   - FedRamp Vulnerability Funnel Workflow
   - Jira Automation approval patterns

2. **DBOS SDK:**
   - `poc-dbos-sales/.agents/skills/dbos-typescript/` (32 reference files)
   - Learnings from sales analysis workflow PoC

3. **Supply Chain Security:**
   - CSECR/CSIT reports (dependency confusion, npm malware)
   - Temporal validation patterns
   - GUAC (Graph for Understanding Artifact Composition)

4. **Open-Source Implementations:**
   - Dependabot, Snyk CLI, Trivy + ArgoCD, Mend (WhiteSource)

### Research Questions Answered

| # | Question | Answer Location | Confidence |
|---|----------|-----------------|------------|
| 1 | Ideal workflow architecture? | Summary Q1, Report §1 | HIGH |
| 2 | Deterministic vs agentic? | Summary Q2, Report §2 | HIGH |
| 3 | Human-in-the-loop gates? | Summary Q3, Report §3 | HIGH |
| 4 | Fix validation step? | Summary Q4, Report §4 | HIGH |
| 5 | Rollback patterns? | Summary Q5, Report §5 | MEDIUM |
| 6 | Existing platforms? | Summary Q6, Report §6 | HIGH |
| 7 | Parallel vs sequential? | Summary Q7, Report §7 | HIGH |
| 8 | Transitive dependencies? | Summary Q8, Report §8 | HIGH |
| 9 | State management? | Summary Q9, Report §9 | HIGH |
| 10 | DBOS mappings? | Summary Q10, Report §10 | HIGH |
| 11 | Agent security? | Summary Q11, Report §11 | MEDIUM-HIGH |
| 12 | Open-source examples? | Summary Q12, Report §12 | MEDIUM |

---

## Key Findings Summary

### Architectural Principles
1. **Decompose deterministic vs agentic steps** — different retry/validation strategies
2. **Use DBOS `recv()` for human gates** — integrated with workflow state, no external approver system
3. **Pre-detect transitive deps** — group fixes by dependency chain before generation (1 PR per chain)
4. **Validate via re-scanning** — three-layer check (scan ✓, tests ✓, no regression)
5. **Timeout-driven escalation** — 72h for Critical → escalate to on-call, don't wait indefinitely

### Real-World Data (Atlassian Snyk Pilot)
- **Automation rate:** 80% of Low/Medium severity fixes delivered without human
- **Escalation rate:** ~10% of fixes require human review (complex/context-dependent)
- **Success metric:** <5% manual correction rate on deployed fixes
- **Confidence scoring:** Critical for deciding auto-proceed vs escalate

### DBOS Specifics
- **Determinism rule:** Non-determinism goes INSIDE `runStep()`, not in workflow logic
- **Loop step naming:** `gen-fix-${cveId}-${index}` — must be unique per iteration
- **Parallel execution:** `Promise.allSettled()` for independent; `startWorkflow()` for sequential chains
- **Human gates:** `DBOS.recv()` with timeout drives escalation logic

### Security Guardrails
- **Prompt injection:** Structured output (Zod) + AST validation (detect rm -rf, DROP TABLE)
- **Supply chain:** Temporal check (upload time vs CVE discovery) + npm audit + denylist
- **Code execution:** Sandbox patches before merge; manual review for high-risk changes

---

## Implementation Roadmap

| Phase | Timeline | Deliverable | Success Metric |
|-------|----------|-------------|----------------|
| **MVP** | Weeks 1–4 | Scan → Triage → PR (mock LLM) | 1 end-to-end workflow |
| **Agentic** | Weeks 5–8 | Real LLM + validation + confidence scoring | 80% automation rate |
| **Supply Chain** | Weeks 9–12 | Transitive detection + rollback + validation | 0 compromised merges |
| **Optimization** | Weeks 13+ | Parallel approval + threshold tuning | <10% escalation |

---

## Next Steps for Your Team

### Immediate (Week 1)
- [ ] Read Summary document (30 min)
- [ ] Review DBOS determinism rules in main report (20 min)
- [ ] Sketch MVP workflow (2 hours)

### Short-term (Weeks 2–4)
- [ ] Build scanner → triage → PR scaffold (with mock LLM)
- [ ] Implement Slack approval bot
- [ ] Test DBOS.recv() for human gates

### Medium-term (Weeks 5–8)
- [ ] Integrate real LLM (Claude/Gemini) with structured output
- [ ] Implement validation sub-workflow (re-scan + tests)
- [ ] Calibrate confidence thresholds on 50+ test fixes

### Long-term (Weeks 9+)
- [ ] Transitive dependency detection
- [ ] Rollback automation
- [ ] Production monitoring + alert integration

---

## Related Documentation

- **DBOS TypeScript Skill:** `/poc-dbos-sales/.agents/skills/dbos-typescript/` (32 reference files)
  - Key reads: `workflow-determinism.md`, `queue-basics.md`, `step-retries.md`, `comm-messages.md`

- **Previous Research Files:**
  - `research/learnings-2026-05-09-10.md` — DBOS PoC learnings
  - `research/agentic-workflow-platform-2026-05-08.md` — Workflow platform landscape

---

## How to Use These Documents

### For Architects
1. Start with Summary (Q1–Q3, Decision Table)
2. Review main report §1 (workflow diagram) and §10 (DBOS mappings)
3. Use implementation roadmap to plan phases

### For Engineers
1. Read Summary (all questions)
2. Study main report §2–4 (deterministic/agentic/validation patterns)
3. Deep-dive into §10 (DBOS v4 code patterns)
4. Reference §11 for security guardrails

### For Security Team
1. Read Summary Q11 (security) and Q6 (existing platforms)
2. Study main report §11 (prompt injection + supply chain attacks)
3. Review state management (§9) for audit trail requirements

### For Leadership
1. Start with Summary (entire document)
2. Review implementation roadmap and key metrics
3. Use architecture decision table to justify technical choices

---

## Document Statistics

| Metric | Value |
|--------|-------|
| Total lines | 1,326 (main) + 154 (summary) |
| Total size | 55.4 KB |
| Code examples | 18 (TypeScript, schema definitions) |
| Diagrams | 2 (ASCII workflows) |
| Tables | 25+ (decision matrices, reference tables) |
| References | 20+ (Atlassian docs, DBOS, supply chain security) |
| Sections | 14 (main) + appendices |

---

## Revision History

| Date | Changes |
|------|---------|
| 2026-05-10 | Initial research complete (v1.0) |

---

## Questions or Feedback?

This research was conducted bottom-up from concrete implementations (Snyk, Bitbucket, DBOS v4) to architectural insights. If you need clarifications on any section:
- **DBOS patterns:** Refer to `/poc-dbos-sales/.agents/skills/dbos-typescript/references/`
- **Snyk data:** See Atlassian asecurityteam wiki (internal)
- **Open-source:** Check GitHub repos: dependabot/dependabot-core, snyk/snyk, aquasecurity/trivy

---

**Generated:** May 10, 2026 | **Research Time:** ~1.5 hours | **Confidence:** HIGH
