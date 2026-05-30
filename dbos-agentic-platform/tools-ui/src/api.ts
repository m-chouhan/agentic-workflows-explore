const BASE = "/workflow";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
  return data as T;
}

// ── Shared workflow types ─────────────────────────────────────────────────────

export interface EnqueueResponse {
  workflowId: string;
  status: string;
  pollUrl: string;
}

export interface WorkflowStatus {
  workflowId: string;
  status: "ENQUEUED" | "PENDING" | "SUCCESS" | "ERROR" | string;
  result?: unknown;
  error?: string;
}

// ── Vulnerability Scanner ─────────────────────────────────────────────────────

export interface ScanFinding {
  id: string;
  scanner: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  packageName: string;
  currentVersion: string;
  fixedVersion?: string;
  cweId?: string;
  filePath: string;
  description: string;
}

export interface TriagedFinding {
  findingId: string;
  adjustedSeverity: string;
  reasoning: string;
  exploitability: string;
  fixType: string;
}

export interface ScanResult {
  id: number;
  workflow_id: string;
  repo: string;
  branch: string;
  scanned_at: string;
  total_findings: number;
  blocker_count: number;
  findings_json: ScanFinding[];
  triage_json: {
    prioritizedFindings: TriagedFinding[];
    executiveSummary: string;
    blockerCount: number;
    recommendedAction: string;
  } | null;
}

export const vulnApi = {
  trigger: (repo: string, branch: string) =>
    request<EnqueueResponse>("/scan", {
      method: "POST",
      body: JSON.stringify({ repo, branch }),
    }),
  poll: (id: string) => request<WorkflowStatus>(`/scan/${id}`),
  findings: (repo: string) =>
    request<ScanResult>(`/findings/${repo.replace("/", "--")}`),
};
