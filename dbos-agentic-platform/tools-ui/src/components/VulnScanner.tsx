import { useState, useEffect, useRef } from "react";
import { vulnApi, ScanResult, TriagedFinding } from "../api";
import "./VulnScanner.css";

type Phase = "idle" | "enqueued" | "pending" | "success" | "error";

const SEV_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export default function VulnScanner() {
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [phase, setPhase] = useState<Phase>("idle");
  const [workflowId, setWorkflowId] = useState<string>("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [pollCount, setPollCount] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  useEffect(() => () => stopPolling(), []);

  const startPolling = (wfId: string, repoName: string) => {
    let count = 0;
    setPollCount(0);
    pollRef.current = setInterval(async () => {
      count++;
      setPollCount(count);
      if (count > 80) {
        stopPolling();
        setPhase("error");
        setErrorMsg("Timed out after 4 minutes. Scans of large repos may take longer.");
        return;
      }
      try {
        const status = await vulnApi.poll(wfId);
        if (status.status === "SUCCESS") {
          stopPolling();
          const data = await vulnApi.findings(repoName);
          setResult(data);
          setPhase("success");
        } else if (status.status === "ERROR") {
          stopPolling();
          setPhase("error");
          setErrorMsg(status.error ?? "Scan workflow failed.");
        } else {
          setPhase(status.status === "ENQUEUED" ? "enqueued" : "pending");
        }
      } catch {
        // transient error — keep polling
      }
    }, 3000);
  };

  const handleScan = async () => {
    if (!repo.trim()) return;
    stopPolling();
    setResult(null);
    setErrorMsg("");
    setPhase("enqueued");
    try {
      const res = await vulnApi.trigger(repo.trim(), branch.trim() || "main");
      setWorkflowId(res.workflowId);
      startPolling(res.workflowId, repo.trim());
    } catch (err) {
      setPhase("error");
      setErrorMsg((err as Error).message);
    }
  };

  const triage = result?.triage_json;
  const sorted = triage
    ? [...triage.prioritizedFindings].sort(
        (a, b) => (SEV_ORDER[a.adjustedSeverity] ?? 9) - (SEV_ORDER[b.adjustedSeverity] ?? 9)
      )
    : [];

  return (
    <div className="tool-panel">
      <div className="tool-header">
        <div className="tool-icon vuln-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <div>
          <h2 className="tool-title">PR / Security Scanner</h2>
          <p className="tool-subtitle">Clone → Trivy scan → Gemini AI triage → prioritized findings</p>
        </div>
      </div>

      <div className="tool-body">
        <div className="input-grid">
          <div className="input-group">
            <label htmlFor="vuln-repo">GitHub Repository</label>
            <input
              id="vuln-repo"
              type="text"
              placeholder="owner/repo  (e.g. expressjs/express)"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleScan()}
              disabled={phase === "enqueued" || phase === "pending"}
            />
          </div>
          <div className="input-group input-branch">
            <label htmlFor="vuln-branch">Branch</label>
            <input
              id="vuln-branch"
              type="text"
              placeholder="main"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              disabled={phase === "enqueued" || phase === "pending"}
            />
          </div>
          <button
            className="run-btn vuln-btn"
            onClick={handleScan}
            disabled={!repo.trim() || phase === "enqueued" || phase === "pending"}
          >
            {phase === "enqueued" || phase === "pending" ? (
              <><span className="spinner" />Scanning...</>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                Scan Repo
              </>
            )}
          </button>
        </div>

        <div className="scan-hints">
          <span>Try:</span>
          {["expressjs/express", "lodash/lodash", "axios/axios"].map((r) => (
            <button
              key={r}
              className="hint-btn"
              onClick={() => setRepo(r)}
              disabled={phase === "enqueued" || phase === "pending"}
            >
              {r}
            </button>
          ))}
        </div>

        {(phase === "enqueued" || phase === "pending") && (
          <div className="status-bar">
            <div className="progress-track">
              <div className="progress-fill vuln-fill" style={{ width: `${Math.min((pollCount / 80) * 100, 95)}%` }} />
            </div>
            <div className="status-row">
              <StatusChip status={phase} />
              {workflowId && <span className="wf-id mono">{workflowId}</span>}
              <span className="poll-count">{pollCount * 3}s elapsed</span>
            </div>
            <p className="scan-note">Cloning repo and running Trivy... this may take 30-120s.</p>
          </div>
        )}

        {phase === "error" && (
          <div className="alert error">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {errorMsg}
          </div>
        )}

        {phase === "success" && result && (
          <div className="results">
            <div className="result-status-row">
              <StatusChip status="success" />
              {workflowId && <span className="wf-id mono">{workflowId}</span>}
            </div>

            <div className="scan-summary">
              <SummaryBadge label="Total Findings" value={result.total_findings} accent="blue" />
              <SummaryBadge label="Blockers" value={result.blocker_count} accent="red" />
              <SummaryBadge label="Repo" value={result.repo} accent="purple" />
              <SummaryBadge label="Branch" value={result.branch} accent="green" />
            </div>

            {triage && (
              <>
                <div className="executive-summary">
                  <div className="exec-header">
                    <span className="exec-label">AI Triage Summary</span>
                    <ActionChip action={triage.recommendedAction} />
                  </div>
                  <p>{triage.executiveSummary}</p>
                </div>

                {sorted.length > 0 && (
                  <div className="findings-table">
                    <h4>Prioritized Findings ({sorted.length})</h4>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>CVE / ID</th>
                            <th>Severity</th>
                            <th>Fix Type</th>
                            <th>Exploitability</th>
                            <th>Reasoning</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sorted.map((f, i) => (
                            <FindingRow key={i} finding={f} />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}

            {result.total_findings === 0 && (
              <div className="alert success-alert">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22,4 12,14.01 9,11.01" />
                </svg>
                No vulnerabilities found in this repo.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    enqueued: { label: "ENQUEUED", cls: "chip-yellow" },
    pending:  { label: "SCANNING", cls: "chip-blue" },
    success:  { label: "SUCCESS",  cls: "chip-green" },
    error:    { label: "ERROR",    cls: "chip-red" },
    SUCCESS:  { label: "SUCCESS",  cls: "chip-green" },
    ERROR:    { label: "ERROR",    cls: "chip-red" },
  };
  const { label, cls } = map[status] ?? { label: status, cls: "chip-yellow" };
  return <span className={`chip ${cls}`}>{label}</span>;
}

function SummaryBadge({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <div className={`summary-badge accent-${accent}`}>
      <span className="badge-label">{label}</span>
      <span className="badge-value">{value}</span>
    </div>
  );
}

function ActionChip({ action }: { action: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    "block-deploy":      { label: "⛔ Block Deploy",       cls: "action-red" },
    "warn-and-proceed":  { label: "⚠ Warn & Proceed",     cls: "action-yellow" },
    "informational":     { label: "ℹ Informational",      cls: "action-blue" },
  };
  const { label, cls } = map[action] ?? { label: action, cls: "action-blue" };
  return <span className={`action-chip ${cls}`}>{label}</span>;
}

function SeverityChip({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    critical:      "sev-critical",
    high:          "sev-high",
    medium:        "sev-medium",
    low:           "sev-low",
    info:          "sev-info",
    "false-positive": "sev-info",
  };
  return <span className={`sev-chip ${map[severity] ?? "sev-info"}`}>{severity.toUpperCase()}</span>;
}

function FindingRow({ finding }: { finding: TriagedFinding }) {
  return (
    <tr>
      <td><span className="cve-id mono">{finding.findingId}</span></td>
      <td><SeverityChip severity={finding.adjustedSeverity} /></td>
      <td><span className="fix-type">{finding.fixType}</span></td>
      <td><span className="exploitability">{finding.exploitability}</span></td>
      <td className="reasoning">{finding.reasoning}</td>
    </tr>
  );
}
