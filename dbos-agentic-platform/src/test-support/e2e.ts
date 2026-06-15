// Black-box e2e helpers for driving a running stack. Excluded from the build.
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3002";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL ?? 3) * 1000;
const POLL_TIMEOUT_MS = Number(process.env.POLL_TIMEOUT ?? 180) * 1000;

// Per-test budget: poll timeout plus headroom for the enqueue + final fetch.
export const E2E_TIMEOUT_MS = POLL_TIMEOUT_MS + 20_000;

interface JsonResponse {
  status: number;
  body: any;
}

async function getJson(url: string): Promise<JsonResponse> {
  const res = await fetch(url);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function postJson(url: string, payload: unknown): Promise<JsonResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function pollUntilDone(url: string): Promise<any> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let last: unknown;
  while (Date.now() < deadline) {
    const { body } = await getJson(url);
    last = body;
    if (body?.status !== "PENDING" && body?.status !== "ENQUEUED") return body;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Workflow did not complete in ${POLL_TIMEOUT_MS}ms. Last: ${JSON.stringify(last)}`);
}

export async function requireServerUp(): Promise<void> {
  try {
    const res = await fetch(`${BASE_URL}/healthz`);
    if (!res.ok) throw new Error(`healthz ${res.status}`);
  } catch {
    throw new Error(`Server not reachable at ${BASE_URL}. Run: npm run stack:up`);
  }
}

// Enqueue a workflow at `path`, poll to completion, and return its result.
// Throws with context if the enqueue is not accepted or the workflow does not succeed.
export async function runWorkflow(path: string, payload: unknown): Promise<any> {
  const { status, body } = await postJson(`${BASE_URL}${path}`, payload);
  if (status !== 202) throw new Error(`enqueue ${path} → ${status}: ${JSON.stringify(body)}`);

  const final = await pollUntilDone(`${BASE_URL}${path}/${body.workflowId}`);
  if (final.status !== "SUCCESS") {
    throw new Error(`${path} finished ${final.status}: ${JSON.stringify(final.error ?? final)}`);
  }
  return final.result;
}
