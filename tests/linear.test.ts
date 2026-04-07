import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getSharedDb } from "../src/db/index.js";
import { upsertLinearIssues, upsertLinearCycles, upsertLinearTeam } from "../src/linear/store.js";
import { readLinearIssues, readLinearCycles, readLinearTeams } from "../src/linear/query.js";
import type { StoredLinearIssue, StoredLinearCycle, StoredLinearTeam } from "../src/types/linear.js";

function makeIssue(overrides: Partial<StoredLinearIssue> & Pick<StoredLinearIssue, "id" | "identifier" | "team_id" | "state_type">): StoredLinearIssue {
  return {
    team_name: "Engineering",
    title: "Test issue",
    state_name: "In Progress",
    assignee: null,
    estimate: null,
    priority: null,
    url: "https://linear.app/test/issue/ENG-1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    due_date: null,
    fetched_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeCycle(overrides: Partial<StoredLinearCycle> & Pick<StoredLinearCycle, "id" | "team_id" | "number">): StoredLinearCycle {
  return {
    name: null,
    starts_at: "2026-03-01T00:00:00Z",
    ends_at: "2026-03-14T00:00:00Z",
    progress: 0.5,
    fetched_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeTeam(overrides: Partial<StoredLinearTeam> & Pick<StoredLinearTeam, "id">): StoredLinearTeam {
  return {
    name: "Engineering",
    key: "ENG",
    fetched_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("Linear store/query roundtrip", () => {
  let tempDir: string;
  let dbPath: string;

  afterEach(() => {
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
    tempDir = mkdtempSync(join(tmpdir(), "team-data-linear-test-"));
    dbPath = join(tempDir, "test.db");
    getSharedDb(dbPath);
    return dbPath;
  }

  it("upsertLinearIssues roundtrip: inserts 3 issues with different state_types and reads them back", () => {
    const path = freshDb();
    const issues: StoredLinearIssue[] = [
      makeIssue({ id: "issue-1", identifier: "ENG-1", team_id: "team-a", state_type: "started", state_name: "In Progress" }),
      makeIssue({ id: "issue-2", identifier: "ENG-2", team_id: "team-a", state_type: "completed", state_name: "Done", completed_at: "2026-03-10T12:00:00Z" }),
      makeIssue({ id: "issue-3", identifier: "ENG-3", team_id: "team-a", state_type: "unstarted", state_name: "Todo" }),
    ];

    upsertLinearIssues(issues, path);
    const result = readLinearIssues("team-a", { dbPath: path });

    expect(result).toHaveLength(3);
    const stateTypes = result.map((r) => r.state_type).sort();
    expect(stateTypes).toEqual(["completed", "started", "unstarted"]);
    expect(result.find((r) => r.id === "issue-2")?.completed_at).toBe("2026-03-10T12:00:00Z");
  });

  it("upsertLinearIssues upsert behavior: re-inserting updates title and leaves only 1 row", () => {
    const path = freshDb();
    const issue = makeIssue({ id: "issue-10", identifier: "ENG-10", team_id: "team-a", state_type: "started", title: "Original title" });
    upsertLinearIssues([issue], path);

    const updated = { ...issue, title: "Updated title" };
    upsertLinearIssues([updated], path);

    const result = readLinearIssues("team-a", { dbPath: path });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Updated title");
  });

  it("readLinearIssues team filter: returns only issues for the specified team", () => {
    const path = freshDb();
    upsertLinearIssues([
      makeIssue({ id: "issue-20", identifier: "ENG-20", team_id: "team-a", state_type: "started" }),
      makeIssue({ id: "issue-21", identifier: "ENG-21", team_id: "team-a", state_type: "started" }),
      makeIssue({ id: "issue-22", identifier: "OPS-1", team_id: "team-b", state_type: "started" }),
    ], path);

    const resultA = readLinearIssues("team-a", { dbPath: path });
    expect(resultA).toHaveLength(2);
    expect(resultA.every((r) => r.team_id === "team-a")).toBe(true);

    const resultB = readLinearIssues("team-b", { dbPath: path });
    expect(resultB).toHaveLength(1);
    expect(resultB[0].identifier).toBe("OPS-1");
  });

  it("readLinearIssues stateType filter: returns only issues with the specified state_type", () => {
    const path = freshDb();
    upsertLinearIssues([
      makeIssue({ id: "issue-30", identifier: "ENG-30", team_id: "team-a", state_type: "started" }),
      makeIssue({ id: "issue-31", identifier: "ENG-31", team_id: "team-a", state_type: "completed" }),
      makeIssue({ id: "issue-32", identifier: "ENG-32", team_id: "team-a", state_type: "started" }),
    ], path);

    const result = readLinearIssues("team-a", { stateType: "started", dbPath: path });
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.state_type === "started")).toBe(true);
  });

  it("upsertLinearCycles + readLinearCycles roundtrip: inserts 2 cycles and reads them back", () => {
    const path = freshDb();
    const cycles: StoredLinearCycle[] = [
      makeCycle({ id: "cycle-1", team_id: "team-a", number: 1, name: "Sprint 1", starts_at: "2026-03-01T00:00:00Z", ends_at: "2026-03-14T00:00:00Z", progress: 1.0 }),
      makeCycle({ id: "cycle-2", team_id: "team-a", number: 2, name: "Sprint 2", starts_at: "2026-03-15T00:00:00Z", ends_at: "2026-03-28T00:00:00Z", progress: 0.5 }),
    ];

    upsertLinearCycles(cycles, path);
    const result = readLinearCycles("team-a", { dbPath: path });

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.name).sort()).toEqual(["Sprint 1", "Sprint 2"]);
    expect(result.find((r) => r.id === "cycle-1")?.progress).toBe(1.0);
  });

  it("upsertLinearTeam + readLinearTeams roundtrip: inserts a team and reads it back", () => {
    const path = freshDb();
    const team = makeTeam({ id: "team-a", name: "Engineering", key: "ENG" });
    upsertLinearTeam(team, path);

    const result = readLinearTeams(path);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("team-a");
    expect(result[0].name).toBe("Engineering");
    expect(result[0].key).toBe("ENG");
  });
});
