import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getSharedDb } from "../src/db/index.js";

describe("getSharedDb", () => {
  let tempDir: string;

  afterEach(() => {
    // Reset the singleton so each test gets a fresh DB
    const g = globalThis as typeof globalThis & { __teamDataDb?: unknown };
    if (g.__teamDataDb) {
      // Close the DB connection before cleanup
      const db = g.__teamDataDb as { close: () => void };
      try { db.close(); } catch { /* ignore */ }
      delete g.__teamDataDb;
    }
    // Clean up temp directory
    if (tempDir) {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it("creates a DB file at the specified path", () => {
    tempDir = mkdtempSync(join(tmpdir(), "team-data-test-"));
    const dbPath = join(tempDir, "test.db");
    const db = getSharedDb(dbPath);
    expect(db).toBeDefined();
    expect(existsSync(dbPath)).toBe(true);
  });

  it("creates all 6 required tables", () => {
    tempDir = mkdtempSync(join(tmpdir(), "team-data-test-"));
    const dbPath = join(tempDir, "test.db");
    const db = getSharedDb(dbPath);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("pull_requests");
    expect(tableNames).toContain("reviews");
    expect(tableNames).toContain("deployments");
    expect(tableNames).toContain("linear_issues");
    expect(tableNames).toContain("linear_cycles");
    expect(tableNames).toContain("linear_teams");
  });

  it("does NOT create app-specific tables (cycle_snapshots, health_snapshots)", () => {
    tempDir = mkdtempSync(join(tmpdir(), "team-data-test-"));
    const dbPath = join(tempDir, "test.db");
    const db = getSharedDb(dbPath);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).not.toContain("cycle_snapshots");
    expect(tableNames).not.toContain("health_snapshots");
  });

  it("enables WAL mode", () => {
    tempDir = mkdtempSync(join(tmpdir(), "team-data-test-"));
    const dbPath = join(tempDir, "test.db");
    const db = getSharedDb(dbPath);

    const result = db.pragma("journal_mode") as { journal_mode: string }[];
    expect(result[0].journal_mode).toBe("wal");
  });

  it("returns the same singleton instance on repeated calls", () => {
    tempDir = mkdtempSync(join(tmpdir(), "team-data-test-"));
    const dbPath = join(tempDir, "test.db");
    const db1 = getSharedDb(dbPath);
    const db2 = getSharedDb(dbPath);
    expect(db1).toBe(db2);
  });

  it("enables foreign keys", () => {
    tempDir = mkdtempSync(join(tmpdir(), "team-data-test-"));
    const dbPath = join(tempDir, "test.db");
    const db = getSharedDb(dbPath);

    const result = db.pragma("foreign_keys") as { foreign_keys: number }[];
    expect(result[0].foreign_keys).toBe(1);
  });
});
