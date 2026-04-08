import { Octokit } from "octokit";
import type { StoredPR, StoredReview } from "../types/github.js";
import { upsertPRs, upsertReviews } from "./store.js";

export async function fetchAndStorePRs(
  token: string,
  owner: string,
  repo: string,
  options: { lookbackDays?: number; maxPRs?: number; dbPath?: string } = {}
): Promise<{ prCount: number; reviewCount: number }> {
  const { lookbackDays = 30, maxPRs = 500, dbPath } = options;

  const octokit = new Octokit({
    auth: token,
    retry: { enabled: false },
    throttle: { enabled: false },
  });

  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  // Paginate PRs sorted by updated desc, stopping when PRs fall outside the lookback window
  const pulls = await octokit.paginate(
    octokit.rest.pulls.list,
    {
      owner,
      repo,
      state: "all",
      sort: "updated",
      direction: "desc",
      per_page: 100,
    },
    (response, done) => {
      const page = response.data;
      if (page.length > 0) {
        const oldest = page[page.length - 1];
        if (new Date(oldest.updated_at) < since) {
          done();
        }
      }
      return page;
    }
  );

  // Cap at maxPRs and filter to lookback window (match updated_at used by pagination + queries)
  const recentPulls = pulls
    .slice(0, maxPRs)
    .filter((pr) => new Date(pr.updated_at) >= since);

  const fetchedAt = new Date().toISOString();

  // Map to StoredPR
  const storedPRs: StoredPR[] = recentPulls.map((pr) => ({
    id: `${owner}/${repo}#${pr.number}`,
    repo,
    owner,
    number: pr.number,
    title: pr.title,
    author: pr.user?.login ?? "unknown",
    state: pr.merged_at ? "merged" : pr.state,
    is_draft: pr.draft ? 1 : 0,
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    merged_at: pr.merged_at ?? null,
    closed_at: pr.closed_at ?? null,
    additions: 0,
    deletions: 0,
    team: null,
    fetched_at: fetchedAt,
  }));

  upsertPRs(storedPRs, dbPath);

  // Fetch reviews for up to 50 most-recently-updated PRs
  const prsForReviews = recentPulls.slice(0, 50);
  const reviewResults = await Promise.allSettled(
    prsForReviews.map((pr) =>
      octokit.rest.pulls.listReviews({
        owner,
        repo,
        pull_number: pr.number,
        per_page: 30,
      })
    )
  );

  const storedReviews: StoredReview[] = [];
  prsForReviews.forEach((pr, i) => {
    const result = reviewResults[i];
    if (result.status !== "fulfilled") return;
    for (const review of result.value.data) {
      if (!review.user?.login || !review.submitted_at) continue;
      storedReviews.push({
        id: `${owner}/${repo}#${pr.number}#${review.id}`,
        pr_id: `${owner}/${repo}#${pr.number}`,
        reviewer: review.user.login,
        avatar_url: review.user.avatar_url ?? null,
        state: review.state,
        submitted_at: review.submitted_at,
        fetched_at: fetchedAt,
      });
    }
  });

  upsertReviews(storedReviews, dbPath);

  return { prCount: storedPRs.length, reviewCount: storedReviews.length };
}
