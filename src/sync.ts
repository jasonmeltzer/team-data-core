import { fetchAndStorePRs } from "./github/fetch.js";
import { fetchAndStoreDeployments } from "./github/deployments.js";
import { fetchAndStoreLinearIssues, fetchAndStoreLinearCycles } from "./linear/fetch.js";

export interface SyncGitHubConfig {
  token: string;
  repos: Array<{ owner: string; repo: string }>;
}

export interface SyncLinearConfig {
  apiKey: string;
  teamIds: string[];
}

export interface SyncOptions {
  github?: SyncGitHubConfig;
  linear?: SyncLinearConfig;
  lookbackDays?: number;
  dbPath?: string;
}

export interface SyncResult {
  github: { prCount: number; reviewCount: number; deploymentCount: number } | null;
  linear: { issueCount: number; cycleCount: number } | null;
  errors: string[];
}

/**
 * Fetch and store data from all configured sources into the shared DB.
 * Skips any source that isn't provided. Safe to call repeatedly (upserts).
 */
export async function syncAll(options: SyncOptions): Promise<SyncResult> {
  const lookbackDays = options.lookbackDays ?? 30;
  const dbPath = options.dbPath;
  const errors: string[] = [];

  let github: SyncResult["github"] = null;
  let linear: SyncResult["linear"] = null;

  if (options.github) {
    const { token, repos } = options.github;
    let totalPRs = 0;
    let totalReviews = 0;
    let totalDeployments = 0;

    for (const { owner, repo } of repos) {
      try {
        const pr = await fetchAndStorePRs(token, owner, repo, { lookbackDays, dbPath });
        totalPRs += pr.prCount;
        totalReviews += pr.reviewCount;
      } catch (e) {
        errors.push(`GitHub PRs ${owner}/${repo}: ${e instanceof Error ? e.message : String(e)}`);
      }

      try {
        const deploy = await fetchAndStoreDeployments(token, owner, repo, { lookbackDays, dbPath });
        totalDeployments += deploy.deploymentCount;
      } catch (e) {
        errors.push(`GitHub deployments ${owner}/${repo}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    github = { prCount: totalPRs, reviewCount: totalReviews, deploymentCount: totalDeployments };
  }

  if (options.linear) {
    const { apiKey, teamIds } = options.linear;
    let totalIssues = 0;
    let totalCycles = 0;

    for (const teamId of teamIds) {
      try {
        const issues = await fetchAndStoreLinearIssues(apiKey, teamId, { lookbackDays, dbPath });
        totalIssues += issues.issueCount;
      } catch (e) {
        errors.push(`Linear issues ${teamId}: ${e instanceof Error ? e.message : String(e)}`);
      }

      try {
        const cycles = await fetchAndStoreLinearCycles(apiKey, teamId, { lookbackDays, dbPath });
        totalCycles += cycles.cycleCount;
      } catch (e) {
        errors.push(`Linear cycles ${teamId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    linear = { issueCount: totalIssues, cycleCount: totalCycles };
  }

  return { github, linear, errors };
}
