import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "fs";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Load fixtures at module scope (before vi.mock hoisting)
const pullsFixture = JSON.parse(
  readFileSync(join(import.meta.dirname, "../fixtures/github/pulls-list.json"), "utf-8")
);
const reviewsFixture = JSON.parse(
  readFileSync(join(import.meta.dirname, "../fixtures/github/reviews-list.json"), "utf-8")
);

const LIVE = process.env.INTEGRATION_LIVE === "true";

// vi.mock is hoisted to the top of the file by Vitest even if written conditionally.
// The mock intercepts Octokit: paginate returns the PR fixture flat array,
// listReviews returns 2 reviews only for PR #42, empty for others.
vi.mock("octokit", () => {
  const paginateMock = vi.fn().mockResolvedValue(pullsFixture);

  // Return reviews only for PR 42 to keep review count predictable
  const listReviewsMock = vi.fn().mockImplementation(
    ({ pull_number }: { pull_number: number }) =>
      Promise.resolve({ data: pull_number === 42 ? reviewsFixture : [] })
  );

  function OctokitMock(this: unknown) {
    return {
      paginate: paginateMock,
      rest: {
        pulls: {
          list: {},
          listReviews: listReviewsMock,
        },
      },
    };
  }

  return { Octokit: OctokitMock };
});

describe("GitHub PR + review integration: fetch-store-query roundtrip", () => {
  let tempDir: string;
  let dbPath: string;

  beforeAll(async () => {
    if (LIVE) return; // live mode uses real API — skip mock-based setup
    tempDir = mkdtempSync(join(tmpdir(), "team-data-prs-integration-"));
    dbPath = join(tempDir, "test.db");
    const { getSharedDb } = await import("../../src/db/index.js");
    getSharedDb(dbPath);
  });

  afterAll(() => {
    const g = globalThis as typeof globalThis & { __teamDataDb?: { close: () => void } };
    if (g.__teamDataDb) {
      try { g.__teamDataDb.close(); } catch { /* ignore */ }
      delete g.__teamDataDb;
    }
    if (tempDir) {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    vi.resetAllMocks();
  });

  it("fetchAndStorePRs returns correct counts", async () => {
    const { fetchAndStorePRs } = await import("../../src/github/fetch.js");
    const result = await fetchAndStorePRs("test-token", "testorg", "testrepo", {
      lookbackDays: 365,
      dbPath,
    });

    expect(result.prCount).toBe(3);
    expect(result.reviewCount).toBe(2);
  });

  it("stored PRs queried back with correct count and field values", async () => {
    const { readPRs } = await import("../../src/github/query.js");
    const prs = readPRs("testorg", "testrepo", { lookbackDays: 365, dbPath });

    expect(prs).toHaveLength(3);

    const pr42 = prs.find((p) => p.number === 42);
    expect(pr42?.title).toBe("feat: add widget API");
    expect(pr42?.state).toBe("open");

    const pr41 = prs.find((p) => p.number === 41);
    expect(pr41?.state).toBe("merged");

    const pr40 = prs.find((p) => p.number === 40);
    expect(pr40?.state).toBe("closed");
  });

  it("stored PRs have correct shape", async () => {
    const { readPRs } = await import("../../src/github/query.js");
    const prs = readPRs("testorg", "testrepo", { lookbackDays: 365, dbPath });

    for (const pr of prs) {
      expect(typeof pr.id).toBe("string");
      expect(typeof pr.number).toBe("number");
      expect(typeof pr.is_draft).toBe("number");
      expect(typeof pr.fetched_at).toBe("string");
      expect(pr.fetched_at.length).toBeGreaterThan(0);
    }
  });

  it("stored reviews queried back by PR id", async () => {
    const { readReviewsForPR } = await import("../../src/github/query.js");
    const reviews = readReviewsForPR("testorg/testrepo#42", dbPath);

    expect(reviews).toHaveLength(2);
    const reviewers = reviews.map((r) => r.reviewer);
    expect(reviewers).toContain("dave");
    expect(reviewers).toContain("eve");
  });

  it("stored reviews queried back by repo", async () => {
    const { readReviewsForRepo } = await import("../../src/github/query.js");
    const reviews = readReviewsForRepo("testorg", "testrepo", dbPath);

    // Only PR #42 has reviews (others return empty); expect 2 total
    expect(reviews).toHaveLength(2);
  });
});
