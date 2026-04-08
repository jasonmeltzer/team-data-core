import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "fs";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Load fixtures at module scope (before any vi calls)
const issuesFixture = JSON.parse(
  readFileSync(join(import.meta.dirname, "../fixtures/linear/issues-page1.json"), "utf-8")
);
const teamCyclesFixture = JSON.parse(
  readFileSync(join(import.meta.dirname, "../fixtures/linear/team-cycles.json"), "utf-8")
);

const LIVE = process.env.INTEGRATION_LIVE === "true";

describe("Linear Issues integration: fetch -> store -> query", () => {
  let tempDir: string;
  let dbPath: string;

  beforeAll(async () => {
    if (LIVE) return; // live mode uses real API — skip mock setup

    tempDir = mkdtempSync(join(tmpdir(), "team-data-linear-issues-integration-"));
    dbPath = join(tempDir, "test.db");

    const { getSharedDb } = await import("../../src/db/index.js");
    getSharedDb(dbPath);

    // Stub global fetch: inspect query body to determine which fixture to return.
    // fetchAndStoreLinearIssues sends a query containing "issues"; fetchAndStoreLinearCycles sends "team".
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as { query: string };
        if (body.query.includes("issues")) {
          return Promise.resolve({ ok: true, json: async () => issuesFixture });
        }
        return Promise.resolve({ ok: true, json: async () => teamCyclesFixture });
      })
    );
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
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("fetchAndStoreLinearIssues returns correct count", async () => {
    const { fetchAndStoreLinearIssues } = await import("../../src/linear/fetch.js");
    const result = await fetchAndStoreLinearIssues("test-key", "team-abc", {
      lookbackDays: 365,
      dbPath,
    });
    expect(result.issueCount).toBe(3);
  });

  it("stored issues queried back with correct count and field values", async () => {
    const { readLinearIssues } = await import("../../src/linear/query.js");
    const issues = readLinearIssues("team-abc", { lookbackDays: 365, dbPath });

    expect(issues).toHaveLength(3);

    const eng101 = issues.find((i) => i.identifier === "ENG-101");
    expect(eng101?.title).toBe("Implement user auth");
    expect(eng101?.state_type).toBe("started");
    expect(eng101?.assignee).toBe("Alice Smith");

    const eng102 = issues.find((i) => i.identifier === "ENG-102");
    expect(eng102?.state_type).toBe("completed");

    const eng103 = issues.find((i) => i.identifier === "ENG-103");
    expect(eng103?.assignee).toBeNull();
  });

  it("stored issues have correct shape", async () => {
    const { readLinearIssues } = await import("../../src/linear/query.js");
    const issues = readLinearIssues("team-abc", { lookbackDays: 365, dbPath });

    const validStateTypes = ["backlog", "started", "completed", "unstarted", "cancelled", "triage"];

    for (const issue of issues) {
      expect(typeof issue.id).toBe("string");
      expect(typeof issue.identifier).toBe("string");
      expect(typeof issue.team_id).toBe("string");
      expect(typeof issue.fetched_at).toBe("string");
      expect(issue.state_name).toBeTruthy();
      expect(validStateTypes).toContain(issue.state_type);
    }
  });
});

describe("Linear Cycles integration: fetch -> store -> query", () => {
  let tempDir: string;
  let dbPath: string;

  beforeAll(async () => {
    if (LIVE) return; // live mode uses real API — skip mock setup

    tempDir = mkdtempSync(join(tmpdir(), "team-data-linear-cycles-integration-"));
    dbPath = join(tempDir, "test.db");

    const { getSharedDb } = await import("../../src/db/index.js");
    getSharedDb(dbPath);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as { query: string };
        if (body.query.includes("issues")) {
          return Promise.resolve({ ok: true, json: async () => issuesFixture });
        }
        return Promise.resolve({ ok: true, json: async () => teamCyclesFixture });
      })
    );
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
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("fetchAndStoreLinearCycles returns correct count", async () => {
    const { fetchAndStoreLinearCycles } = await import("../../src/linear/fetch.js");
    const result = await fetchAndStoreLinearCycles("test-key", "team-abc", {
      lookbackDays: 365,
      dbPath,
    });
    expect(result.cycleCount).toBe(2);
  });

  it("stored cycles queried back with correct values", async () => {
    const { readLinearCycles } = await import("../../src/linear/query.js");
    const cycles = readLinearCycles("team-abc", { lookbackDays: 365, dbPath });

    expect(cycles).toHaveLength(2);

    const sprint10 = cycles.find((c) => c.id === "cycle-001");
    expect(sprint10?.name).toBe("Sprint 10");
    expect(sprint10?.number).toBe(10);
    expect(sprint10?.progress).toBe(0.45);
  });

  it("team was stored by fetchAndStoreLinearCycles", async () => {
    const { readLinearTeams } = await import("../../src/linear/query.js");
    const teams = readLinearTeams(dbPath);

    expect(teams).toHaveLength(1);
    expect(teams[0].id).toBe("team-abc");
    expect(teams[0].name).toBe("Engineering");
    expect(teams[0].key).toBe("ENG");
  });

  it("stored cycles have correct shape", async () => {
    const { readLinearCycles } = await import("../../src/linear/query.js");
    const cycles = readLinearCycles("team-abc", { lookbackDays: 365, dbPath });

    for (const cycle of cycles) {
      expect(typeof cycle.id).toBe("string");
      expect(typeof cycle.number).toBe("number");
      expect(typeof cycle.progress).toBe("number");
      expect(typeof cycle.starts_at).toBe("string");
    }
  });
});
