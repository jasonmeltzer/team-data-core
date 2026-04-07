import { getSharedDb } from "../db/index.js";
import type { StoredPR, StoredReview } from "../types/github.js";

export function upsertPRs(prs: StoredPR[], dbPath?: string): void {
  if (prs.length === 0) return;
  const db = getSharedDb(dbPath);
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO pull_requests
      (id, repo, owner, number, title, author, state, is_draft,
       created_at, updated_at, merged_at, closed_at, additions, deletions,
       team, fetched_at)
    VALUES
      (@id, @repo, @owner, @number, @title, @author, @state, @is_draft,
       @created_at, @updated_at, @merged_at, @closed_at, @additions, @deletions,
       @team, @fetched_at)
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
    INSERT OR REPLACE INTO reviews
      (id, pr_id, reviewer, avatar_url, state, submitted_at)
    VALUES
      (@id, @pr_id, @reviewer, @avatar_url, @state, @submitted_at)
  `);
  const insertMany = db.transaction((rows: StoredReview[]) => {
    for (const row of rows) {
      stmt.run(row);
    }
  });
  insertMany(reviews);
}
