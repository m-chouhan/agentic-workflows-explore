import { useState, useEffect, useRef } from "react";
import { salesApi, SalesInsights } from "../api";
import "./SalesAnalysis.css";

type Phase = "idle" | "enqueued" | "pending" | "success" | "error";

export default function SalesAnalysis() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [phase, setPhase] = useState<Phase>("idle");
  const [workflowId, setWorkflowId] = useState<string>("");
  const [insights, setInsights] = useState<SalesInsights | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [pollCount, setPollCount] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => () => stopPolling(), []);

  const startPolling = (wfId: string, yr: number) => {
    let count = 0;
    setPollCount(0);
    pollRef.current = setInterval(async () => {
      count++;
      setPollCount(count);
      if (count > 60) {
        stopPolling();
        setPhase("error");
        setErrorMsg("Timed out after 3 minutes.");
        return;
      }
      try {
        const status = await salesApi.poll(wfId);
        if (status.status === "SUCCESS") {
          stopPolling();
          const data = await salesApi.insights(yr);
          setInsights(data);
          setPhase("success");
        } else if (status.status === "ERROR") {
          stopPolling();
          setPhase("error");
          setErrorMsg(status.error ?? "Workflow failed.");
        } else {
          setPhase(status.status === "ENQUEUED" ? "enqueued" : "pending");
        }
      } catch {
        // keep polling on transient errors
      }
    }, 3000);
  };

  const handleRun = async () => {
    stopPolling();
    setInsights(null);
    setErrorMsg("");
    setPhase("enqueued");
    try {
      const res = await salesApi.trigger(year);
      setWorkflowId(res.workflowId);
      startPolling(res.workflowId, year);
    } catch (err) {
      setPhase("error");
      setErrorMsg((err as Error).message);
    }
  };

  const analysis = insights?.insights_json?.analysis;
  const aggregated = insights?.insights_json?.aggregated;

  return (
    <div className="tool-panel">
      <div className="tool-header">
        <div className="tool-icon sales-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="22,7 13.5,15.5 8.5,10.5 2,17" />
            <polyline points="16,7 22,7 22,13" />
          </svg>
        </div>
        <div>
          <h2 className="tool-title">Sales Analysis</h2>
          <p className="tool-subtitle">AI-powered annual sales insights via DBOS + Gemini</p>
        </div>
      </div>

      <div className="tool-body">
        <div className="input-row">
          <div className="input-group">
            <label htmlFor="sales-year">Analysis Year</label>
            <select
              id="sales-year"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              disabled={phase === "enqueued" || phase === "pending"}
            >
              {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <button
            className="run-btn"
            onClick={handleRun}
            disabled={phase === "enqueued" || phase === "pending"}
          >
            {phase === "enqueued" || phase === "pending" ? (
              <>
                <span className="spinner" />
                Running...
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polygon points="5,3 19,12 5,21" />
                </svg>
                Run Analysis
              </>
            )}
          </button>
        </div>

        {(phase === "enqueued" || phase === "pending") && (
          <div className="status-bar">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${Math.min((pollCount / 60) * 100, 95)}%` }} />
            </div>
            <div className="status-row">
              <StatusChip status={phase} />
              {workflowId && <span className="wf-id mono">{workflowId}</span>}
              <span className="poll-count">{pollCount * 3}s elapsed</span>
            </div>
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

        {phase === "success" && insights && analysis && aggregated && (
          <div className="results">
            <div className="result-status-row">
              <StatusChip status="success" />
              {workflowId && <span className="wf-id mono">{workflowId}</span>}
            </div>

            <div className="metrics-grid">
              <MetricCard label="Total Revenue" value={`$${insights.total_revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} accent="blue" />
              <MetricCard label="Units Sold" value={insights.total_units.toLocaleString()} accent="purple" />
              <MetricCard label="Top Product" value={insights.top_product} accent="green" />
              <MetricCard label="Top Region" value={insights.top_region} accent="orange" />
            </div>

            <div className="summary-card">
              <h4>Executive Summary</h4>
              <p>{analysis.summary}</p>
            </div>

            <div className="two-col">
              <InsightList title="Key Highlights" items={analysis.highlights} color="blue" icon="✦" />
              <InsightList title="Recommendations" items={analysis.recommendations} color="green" icon="→" />
            </div>

            {analysis.riskFlags.length > 0 && (
              <InsightList title="Risk Flags" items={analysis.riskFlags} color="red" icon="⚠" />
            )}

            <div className="charts-row">
              <MiniBarChart
                title="Revenue by Product"
                data={aggregated.byProduct.slice(0, 6).map((d) => ({ label: d.product, value: d.revenue }))}
              />
              <MiniBarChart
                title="Revenue by Region"
                data={aggregated.byRegion.map((d) => ({ label: d.region, value: d.revenue }))}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    enqueued: { label: "ENQUEUED", cls: "chip-yellow" },
    pending:  { label: "RUNNING",  cls: "chip-blue" },
    success:  { label: "SUCCESS",  cls: "chip-green" },
    error:    { label: "ERROR",    cls: "chip-red" },
    SUCCESS:  { label: "SUCCESS",  cls: "chip-green" },
    ERROR:    { label: "ERROR",    cls: "chip-red" },
    ENQUEUED: { label: "ENQUEUED", cls: "chip-yellow" },
    PENDING:  { label: "RUNNING",  cls: "chip-blue" },
  };
  const { label, cls } = map[status] ?? { label: status, cls: "chip-yellow" };
  return <span className={`chip ${cls}`}>{label}</span>;
}

function MetricCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className={`metric-card accent-${accent}`}>
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
    </div>
  );
}

function InsightList({ title, items, color, icon }: { title: string; items: string[]; color: string; icon: string }) {
  return (
    <div className={`insight-list color-${color}`}>
      <h4>{title}</h4>
      <ul>
        {items.map((item, i) => (
          <li key={i}>
            <span className="icon">{icon}</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MiniBarChart({ title, data }: { title: string; data: Array<{ label: string; value: number }> }) {
  const max = Math.max(...data.map((d) => d.value));
  return (
    <div className="mini-chart">
      <h4>{title}</h4>
      <div className="bars">
        {data.map((d, i) => (
          <div key={i} className="bar-row">
            <span className="bar-label">{d.label}</span>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(d.value / max) * 100}%` }} />
            </div>
            <span className="bar-value">${(d.value / 1000).toFixed(1)}k</span>
          </div>
        ))}
      </div>
    </div>
  );
}
