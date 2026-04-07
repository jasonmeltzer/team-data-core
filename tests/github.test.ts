import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getSharedDb } from "../src/db/index.js";
import { upsertPRs, upsertReviews } from "../src/github/store.js";
import { readPRs, readReviewsForPR, readReviewsForRepo } from "../src/github/query.js";
import type { StoredPR, StoredReview } from "../src/types/github.js";

function makePR(overrides: Partial<StoredPR> & Pick<StoredPR, "id" | "number" | "state" | "updated_at">): StoredPR {
  return {
    repo: "myrepo",
    owner: "myorg",
    title: "Test PR",
    author: "alice",
    is_draft: 0,
    created_at: "2026-01-01T00:00:00Z",
    merged_at: null,
    closed_at: null,
    additions: 10,
    deletions: 5,
    team: null,
    fetched_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeReview(overrides: Partial<StoredReview> & Pick<StoredReview, "id" | "pr_id">): StoredReview {
  return {
    reviewer: "bob",
    avatar_url: null,
    state: "APPROVED",
    submitted_at: "2026-01-02T10:00:00Z",
    ...overrides,
  };
}

describe("GitHub store/query roundtrip", () => {
  let tempDir: string;
  let dbPath: string;

  afterEach(() => {
    // Reset DB singleton
    const g = globalThis as typeof globalThis & { __teamDataDb?: unknown };
    if (g.__teamDataDb) {
      const db = g.__teamDataDb as { close: () => void };
      try { db.close(); } catch { /* ignore */ }
      delete g.__teamDataDb;
    }
    if (tempDir) {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  function freshDb(): string {
    tempDir = mkdtempSync(join(tmpdir(), "team-data-github-test-"));
    dbPath = join(tempDir, "test.db");
    getSharedDb(dbPath); // initialize schema
    return dbPath;
  }

  it("upsertPRs roundtrip: inserts 3 PRs with different states and reads them back", () => {
    const path = freshDb();
    const prs: StoredPR[] = [
      makePR({ id: "myorg/myrepo#1", number: 1, state: "open", updated_at: "2026-03-20T00:00:00Z" }),
      makePR({ id: "myorg/myrepo#2", number: 2, state: "merged", updated_at: "2026-03-21T00:00:00Z", merged_at: "2026-03-21T12:00:00Z" }),
      makePR({ id: "myorg/myrepo#3", number: 3, state: "closed", updated_at: "2026-03-22T00:00:00Z", closed_at: "2026-03-22T08:00:00Z" }),
    ];

    upsertPRs(prs, path);
    const result = readPRs("myorg", "myrepo", { lookbackDays: 60, dbPath: path });

    expect(result).toHaveLength(3);
    const states = result.map((r) => r.state).sort();
    expect(states).toEqual(["closed", "merged", "open"]);
    expect(result.find((r) => r.number === 2)?.merged_at).toBe("2026-03-21T12:00:00Z");
  });

  it("upsertPRs upsert behavior: updating a PR replaces it and leaves only 1 row", () => {
    const path = freshDb();
    const pr = makePR({ id: "myorg/myrepo#10", number: 10, state: "open", updated_at: "2026-03-20T00:00:00Z", title: "Original title" });
    upsertPRs([pr], path);

    const updated = { ...pr, title: "Updated title" };
    upsertPRs([updated], path);

    const result = readPRs("myorg", "myrepo", { lookbackDays: 60, dbPath: path });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Updated title");
  });

  it("readPRs lookback filter: only returns PRs within the lookback window", () => {
    const path = freshDb();
    const now = new Date();
    const recent = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const old = new Date(now.getTime() - 50 * 24 * 60 * 60 * 1000).toISOString();

    upsertPRs([
      makePR({ id: "myorg/myrepo#20", number: 20, state: "open", updated_at: recent }),
      makePR({ id: "myorg/myrepo#21", number: 21, state: "open", updated_at: old }),
    ], path);

    const result = readPRs("myorg", "myrepo", { lookbackDays: 30, dbPath: path });
    expect(result).toHaveLength(1);
    expect(result[0].number).toBe(20);
  });

  it("readPRs state filter: returns only PRs matching the given state", () => {
    const path = freshDb();
    const updated_at = new Date().toISOString();
    upsertPRs([
      makePR({ id: "myorg/myrepo#30", number: 30, state: "open", updated_at }),
      makePR({ id: "myorg/myrepo#31", number: 31, state: "merged", updated_at }),
      makePR({ id: "myorg/myrepo#32", number: 32, state: "open", updated_at }),
    ], path);

    const result = readPRs("myorg", "myrepo", { lookbackDays: 30, state: "open", dbPath: path });
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.state === "open")).toBe(true);
  });

  it("upsertReviews + readReviewsForPR roundtrip: inserts reviews and reads back by PR id", () => {
    const path = freshDb();
    const pr = makePR({ id: "myorg/myrepo#40", number: 40, state: "merged", updated_at: new Date().toISOString(), merged_at: new Date().toISOString() });
    upsertPRs([pr], path);

    const reviews: StoredReview[] = [
      makeReview({ id: "myorg/myrepo#40#1001", pr_id: "myorg/myrepo#40", reviewer: "alice", state: "APPROVED", submitted_at: "2026-03-20T10:00:00Z" }),
      makeReview({ id: "myorg/myrepo#40#1002", pr_id: "myorg/myrepo#40", reviewer: "charlie", state: "CHANGES_REQUESTED", submitted_at: "2026-03-20T11:00:00Z" }),
    ];
    upsertReviews(reviews, path);

    const result = readReviewsForPR("myorg/myrepo#40", path);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.reviewer).sort()).toEqual(["alice", "charlie"]);
  });

  it("readReviewsForRepo: returns only reviews for the given repo", () => {
    const path = freshDb();
    const now = new Date().toISOString();

    // Two PRs in different repos
    upsertPRs([
      makePR({ id: "myorg/repo-a#50", number: 50, state: "merged", repo: "repo-a", updated_at: now, merged_at: now }),
      makePR({ id: "myorg/repo-b#51", number: 51, state: "merged", repo: "repo-b", updated_at: now, merged_at: now }),
    ], path);

    upsertReviews([
      makeReview({ id: "myorg/repo-a#50#2001", pr_id: "myorg/repo-a#50", reviewer: "dave" }),
      makeReview({ id: "myorg/repo-a#50#2002", pr_id: "myorg/repo-a#50", reviewer: "eve" }),
      makeReview({ id: "myorg/repo-b#51#2003", pr_id: "myorg/repo-b#51", reviewer: "frank" }),
    ], path);

    const resultA = readReviewsForRepo("myorg", "repo-a", path);
    expect(resultA).toHaveLength(2);
    expect(resultA.map((r) => r.reviewer).sort()).toEqual(["dave", "eve"]);

    const resultB = readReviewsForRepo("myorg", "repo-b", path);
    expect(resultB).toHaveLength(1);
    expect(resultB[0].reviewer).toBe("frank");
  });
});
