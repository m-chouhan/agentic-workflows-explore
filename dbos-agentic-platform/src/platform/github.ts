/**
 * GitHub client setup — @octokit/rest (CJS-compatible). Shared platform infra.
 *
 * Supports PAT auth for local dev: set GITHUB_TOKEN env var.
 * For production: use @octokit/auth-app with GitHub App credentials.
 */
import { Octokit } from "@octokit/rest";

let _octokit: Octokit | undefined;

export function getOctokit(): Octokit {
  if (_octokit) return _octokit;

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "Missing GITHUB_TOKEN env var. Set a PAT for local dev, " +
      "or configure GitHub App auth (GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY + GITHUB_APP_INSTALLATION_ID).",
    );
  }

  _octokit = new Octokit({ auth: token });
  return _octokit;
}

/** Parse "owner/repo" format into components. */
export function parseRepo(fullName: string): { owner: string; repo: string } {
  const parts = fullName.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repo format: "${fullName}". Expected "owner/repo".`);
  }
  return { owner: parts[0], repo: parts[1] };
}
