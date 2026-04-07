import { Octokit } from "octokit";
import { getSharedDb } from "../db/index.js";
import type { StoredDeployment } from "../types/github.js";

export function upsertDeployments(deployments: StoredDeployment[], dbPath?: string): void {
  if (deployments.length === 0) return;
  const db = getSharedDb(dbPath);
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO deployments
      (id, repo, owner, environment, status, sha, ref, creator, description,
       caused_incident, created_at, completed_at, team, fetched_at)
    VALUES
      (@id, @repo, @owner, @environment, @status, @sha, @ref, @creator, @description,
       @caused_incident, @created_at, @completed_at, @team, @fetched_at)
  `);
  const insertMany = db.transaction((rows: StoredDeployment[]) => {
    for (const row of rows) {
      stmt.run(row);
    }
  });
  insertMany(deployments);
}

export function readDeployments(
  owner: string,
  repo: string,
  options: { lookbackDays?: number; environment?: string; dbPath?: string } = {}
): StoredDeployment[] {
  const { lookbackDays, environment, dbPath } = options;
  const db = getSharedDb(dbPath);

  const conditions: string[] = ["owner = ?", "repo = ?"];
  const params: unknown[] = [owner, repo];

  if (lookbackDays != null) {
    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
    conditions.push("created_at >= ?");
    params.push(since);
  }

  if (environment != null) {
    conditions.push("environment = ?");
    params.push(environment);
  }

  const sql = `SELECT * FROM deployments WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`;
  return db.prepare(sql).all(...params) as StoredDeployment[];
}

export async function fetchAndStoreDeployments(
  token: string,
  owner: string,
  repo: string,
  options: {
    lookbackDays?: number;
    environment?: string;
    source?: "deployments" | "releases" | "merges" | "auto";
    dbPath?: string;
  } = {}
): Promise<{ deploymentCount: number }> {
  const { lookbackDays = 30, environment = "production", source = "auto", dbPath } = options;

  const octokit = new Octokit({ auth: token, retry: { enabled: false }, throttle: { enabled: false } });
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const fetchedAt = new Date().toISOString();

  let deployments: StoredDeployment[];

  if (source === "releases") {
    deployments = await fetchReleasesAsDeployments(octokit, owner, repo, since, fetchedAt);
  } else if (source === "deployments") {
    deployments = await fetchDeploymentsAPI(octokit, owner, repo, since, environment, fetchedAt);
  } else if (source === "merges") {
    deployments = await fetchMergesAsDeployments(octokit, owner, repo, since, fetchedAt);
  } else {
    // auto: sequential waterfall — must check each source before falling back
    deployments = await fetchDeploymentsAPI(octokit, owner, repo, since, environment, fetchedAt);
    if (deployments.length === 0) {
      deployments = await fetchReleasesAsDeployments(octokit, owner, repo, since, fetchedAt);
    }
    if (deployments.length === 0) {
      deployments = await fetchMergesAsDeployments(octokit, owner, repo, since, fetchedAt);
    }
  }

  upsertDeployments(deployments, dbPath);
  return { deploymentCount: deployments.length };
}

async function fetchDeploymentsAPI(
  octokit: Octokit,
  owner: string,
  repo: string,
  since: Date,
  environment: string,
  fetchedAt: string
): Promise<StoredDeployment[]> {
  try {
    const { data: deploys } = await octokit.rest.repos.listDeployments({
      owner,
      repo,
      environment,
      per_page: 100,
    });

    const recentDeploys = deploys.filter((d) => new Date(d.created_at) >= since);
    const deploysToCheck = recentDeploys.slice(0, 50);

    const statusResults = await Promise.allSettled(
      deploysToCheck.map((d) =>
        octokit.rest.repos.listDeploymentStatuses({
          owner,
          repo,
          deployment_id: d.id,
          per_page: 1,
        })
      )
    );

    return deploysToCheck.map((d, i): StoredDeployment => {
      const statusResult = statusResults[i];
      let status = "pending";
      let completedAt: string | null = null;

      if (statusResult.status === "fulfilled") {
        const statuses = statusResult.value.data;
        if (statuses.length > 0) {
          const s = statuses[0].state;
          if (s === "success" || s === "inactive") {
            status = "success";
            completedAt = statuses[0].updated_at ?? null;
          } else if (s === "failure") {
            status = "failure";
            completedAt = statuses[0].updated_at ?? null;
          } else if (s === "error") {
            status = "error";
            completedAt = statuses[0].updated_at ?? null;
          }
        }
      }

      return {
        id: `${owner}/${repo}#deploy-${d.id}`,
        repo,
        owner,
        environment: d.environment,
        status,
        sha: d.sha,
        ref: d.ref,
        creator: d.creator?.login ?? null,
        description: d.description ?? null,
        caused_incident: 0,
        created_at: d.created_at,
        completed_at: completedAt,
        team: null,
        fetched_at: fetchedAt,
      };
    });
  } catch {
    return [];
  }
}

async function fetchReleasesAsDeployments(
  octokit: Octokit,
  owner: string,
  repo: string,
  since: Date,
  fetchedAt: string
): Promise<StoredDeployment[]> {
  try {
    const { data: releases } = await octokit.rest.repos.listReleases({
      owner,
      repo,
      per_page: 100,
    });

    return releases
      .filter((r) => !r.draft && new Date(r.published_at ?? r.created_at) >= since)
      .map((r): StoredDeployment => ({
        id: `${owner}/${repo}#release-${r.id}`,
        repo,
        owner,
        environment: "production",
        status: "success",
        sha: r.target_commitish,
        ref: r.tag_name,
        creator: r.author?.login ?? null,
        description: r.name ?? r.tag_name,
        caused_incident: 0,
        created_at: r.published_at ?? r.created_at,
        completed_at: r.published_at ?? r.created_at,
        team: null,
        fetched_at: fetchedAt,
      }));
  } catch {
    return [];
  }
}

async function fetchMergesAsDeployments(
  octokit: Octokit,
  owner: string,
  repo: string,
  since: Date,
  fetchedAt: string
): Promise<StoredDeployment[]> {
  try {
    const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
    const defaultBranch = repoData.default_branch;

    const { data: pulls } = await octokit.rest.pulls.list({
      owner,
      repo,
      state: "closed",
      base: defaultBranch,
      sort: "updated",
      direction: "desc",
      per_page: 100,
    });

    return pulls
      .filter((pr) => pr.merged_at && new Date(pr.merged_at) >= since)
      .map((pr): StoredDeployment => ({
        id: `${owner}/${repo}#merge-${pr.number}`,
        repo,
        owner,
        environment: "production",
        status: "success",
        sha: pr.merge_commit_sha ?? null,
        ref: defaultBranch,
        creator: pr.user?.login ?? null,
        description: pr.title,
        caused_incident: 0,
        created_at: pr.merged_at!,
        completed_at: pr.merged_at!,
        team: null,
        fetched_at: fetchedAt,
      }));
  } catch {
    return [];
  }
}
