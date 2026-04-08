import { getSharedDb } from "../db/index.js";
import type { StoredPR, StoredReview } from "../types/github.js";

export function upsertPRs(prs: StoredPR[], dbPath?: string): void {
  if (prs.length === 0) return;
  const db = getSharedDb(dbPath);
  const stmt = db.prepare(`
    INSERT INTO pull_requests
      (id, repo, owner, number, title, author, state, is_draft,
       created_at, updated_at, merged_at, closed_at, additions, deletions,
       team, fetched_at)
    VALUES
      (@id, @repo, @owner, @number, @title, @author, @state, @is_draft,
       @created_at, @updated_at, @merged_at, @closed_at, @additions, @deletions,
       @team, @fetched_at)
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, author=excluded.author, state=excluded.state,
      is_draft=excluded.is_draft, updated_at=excluded.updated_at,
      merged_at=excluded.merged_at, closed_at=excluded.closed_at,
      additions=excluded.additions, deletions=excluded.deletions,
      team=excluded.team, fetched_at=excluded.fetched_at
  `);
  const insertMany = db.transaction((rows: StoredPR[]) => {
    for (const row of rows) {
      stmt.run(row);
    }
  });
  insertMany(prs);
}

export function upsertReviews(reviews: StoredReview[], dbPath?: string): void {
  if (reviews.length === 0) return;
  const db = getSharedDb(dbPath);
  const stmt = db.prepare(`
    INSERT INTO reviews
      (id, pr_id, reviewer, avatar_url, state, submitted_at, fetched_at)
    VALUES
      (@id, @pr_id, @reviewer, @avatar_url, @state, @submitted_at, @fetched_at)
    ON CONFLICT(id) DO UPDATE SET
      state=excluded.state, submitted_at=excluded.submitted_at,
      avatar_url=excluded.avatar_url, fetched_at=excluded.fetched_at
  `);
  const insertMany = db.transaction((rows: StoredReview[]) => {
    for (const row of rows) {
      stmt.run(row);
    }
  });
  insertMany(reviews);
}
