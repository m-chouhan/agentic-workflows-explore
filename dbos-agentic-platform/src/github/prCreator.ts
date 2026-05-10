/**
 * GitHub PR creation helpers — deterministic steps that use the Git Trees API
 * for atomic multi-file commits.
 *
 * Flow: getBaseSha → createBranch → createCommit (blobs + tree) → createPR → pollChecks
 */
import { getOctokit, parseRepo } from "./octokit";
import type { FixCandidate, PRDescription } from "../schemas/vulnSchemas";

export interface PRResult {
  prUrl: string;
  prNumber: number;
  branchName: string;
  headSha: string;
}

// ── Get the SHA of a branch tip ──────────────────────────────────────────────

async function getBaseSha(fullRepo: string, branch: string): Promise<string> {
  const { owner, repo } = parseRepo(fullRepo);
  const octokit = getOctokit();
  const { data } = await octokit.git.getRef({ owner, repo, ref: `heads/${branch}` });
  return data.object.sha;
}

// ── Create a new branch ──────────────────────────────────────────────────────

async function createBranch(fullRepo: string, branchName: string, baseSha: string): Promise<void> {
  const { owner, repo } = parseRepo(fullRepo);
  const octokit = getOctokit();
  await octokit.git.createRef({
    owner, repo,
    ref: `refs/heads/${branchName}`,
    sha: baseSha,
  });
}

// ── Create an atomic commit with multiple file changes via Git Trees API ────

interface FileChange {
  path: string;
  content: string;
}

async function createCommit(
  fullRepo: string,
  branchName: string,
  parentSha: string,
  message: string,
  files: FileChange[],
): Promise<string> {
  const { owner, repo } = parseRepo(fullRepo);
  const octokit = getOctokit();

  // Step 1: Create blobs for each file
  const blobShas = await Promise.all(
    files.map(async (f) => {
      const { data } = await octokit.git.createBlob({
        owner, repo,
        content: Buffer.from(f.content).toString("base64"),
        encoding: "base64",
      });
      return { path: f.path, sha: data.sha };
    }),
  );

  // Step 2: Get base tree
  const { data: baseCommit } = await octokit.git.getCommit({ owner, repo, commit_sha: parentSha });
  const baseTreeSha = baseCommit.tree.sha;

  // Step 3: Create new tree (atomic — all files in one tree)
  const { data: newTree } = await octokit.git.createTree({
    owner, repo,
    base_tree: baseTreeSha,
    tree: blobShas.map((b) => ({
      path: b.path,
      mode: "100644" as const,
      type: "blob" as const,
      sha: b.sha,
    })),
  });

  // Step 4: Create commit
  const { data: newCommit } = await octokit.git.createCommit({
    owner, repo,
    message,
    tree: newTree.sha,
    parents: [parentSha],
  });

  // Step 5: Update branch ref
  await octokit.git.updateRef({
    owner, repo,
    ref: `heads/${branchName}`,
    sha: newCommit.sha,
  });

  return newCommit.sha;
}

// ── Create a Pull Request ────────────────────────────────────────────────────

async function openPR(
  fullRepo: string,
  branchName: string,
  baseBranch: string,
  prDesc: PRDescription,
): Promise<PRResult> {
  const { owner, repo } = parseRepo(fullRepo);
  const octokit = getOctokit();

  const { data: pr } = await octokit.pulls.create({
    owner, repo,
    title: prDesc.title,
    body: prDesc.body,
    head: branchName,
    base: baseBranch,
    draft: true, // Always start as draft — promote after CI passes
  });

  // Add labels if any
  if (prDesc.labels.length > 0) {
    await octokit.issues.addLabels({
      owner, repo,
      issue_number: pr.number,
      labels: prDesc.labels,
    }).catch(() => { /* labels may not exist — non-fatal */ });
  }

  return {
    prUrl: pr.html_url,
    prNumber: pr.number,
    branchName,
    headSha: pr.head.sha,
  };
}

// ── Poll CI check status ─────────────────────────────────────────────────────

export type CheckConclusion = "success" | "failure" | "pending" | "unknown";

async function pollChecks(
  fullRepo: string,
  sha: string,
  timeoutMs: number = 5 * 60 * 1000,
  intervalMs: number = 15_000,
): Promise<CheckConclusion> {
  const { owner, repo } = parseRepo(fullRepo);
  const octokit = getOctokit();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { data } = await octokit.checks.listForRef({ owner, repo, ref: sha });

    if (data.total_count === 0) {
      // No checks configured — treat as success
      return "success";
    }

    const allCompleted = data.check_runs.every((cr: any) => cr.status === "completed");
    if (allCompleted) {
      const allPassed = data.check_runs.every(
        (cr: any) => cr.conclusion === "success" || cr.conclusion === "neutral" || cr.conclusion === "skipped",
      );
      return allPassed ? "success" : "failure";
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return "pending"; // Timed out
}

// ── Public API: Create a fix PR from a FixCandidate ─────────────────────────

export async function createFixPR(
  fullRepo: string,
  baseBranch: string,
  fix: FixCandidate,
  prDesc: PRDescription,
): Promise<PRResult> {
  const branchName = `fix/${fix.findingId}-${Date.now()}`;

  // Step 1: Get base SHA
  const baseSha = await getBaseSha(fullRepo, baseBranch);

  // Step 2: Create branch
  await createBranch(fullRepo, branchName, baseSha);

  // Step 3: Prepare file changes
  const files: FileChange[] = fix.changes.map((c) => ({
    path: c.filePath,
    content: c.fixedCode,
  }));

  // Step 4: Create atomic commit
  const commitMessage = `Security: Fix ${fix.findingId}\n\n${fix.explanation}`;
  await createCommit(fullRepo, branchName, baseSha, commitMessage, files);

  // Step 5: Open draft PR
  const prResult = await openPR(fullRepo, branchName, baseBranch, prDesc);

  return prResult;
}

export { pollChecks };
