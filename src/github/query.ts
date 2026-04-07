import { getSharedDb } from "../db/index.js";
import type { StoredPR, StoredReview } from "../types/github.js";

export function readPRs(
  owner: string,
  repo: string,
  options: { lookbackDays?: number; state?: string; dbPath?: string } = {}
): StoredPR[] {
  const { lookbackDays = 30, state, dbPath } = options;
  const db = getSharedDb(dbPath);
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  if (state) {
    return db
      .prepare(
        "SELECT * FROM pull_requests WHERE owner = ? AND repo = ? AND updated_at >= ? AND state = ? ORDER BY updated_at DESC"
      )
      .all(owner, repo, since, state) as StoredPR[];
  }

  return db
    .prepare(
      "SELECT * FROM pull_requests WHERE owner = ? AND repo = ? AND updated_at >= ? ORDER BY updated_at DESC"
    )
    .all(owner, repo, since) as StoredPR[];
}

export function readReviewsForPR(prId: string, dbPath?: string): StoredReview[] {
  const db = getSharedDb(dbPath);
  return db
    .prepare("SELECT * FROM reviews WHERE pr_id = ? ORDER BY submitted_at ASC")
    .all(prId) as StoredReview[];
}

export function readReviewsForRepo(
  owner: string,
  repo: string,
  dbPath?: string
): StoredReview[] {
  const db = getSharedDb(dbPath);
  return db
    .prepare(
      `SELECT r.* FROM reviews r
       JOIN pull_requests p ON r.pr_id = p.id
       WHERE p.owner = ? AND p.repo = ?
       ORDER BY r.submitted_at ASC`
    )
    .all(owner, repo) as StoredReview[];
}
