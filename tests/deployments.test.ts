import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getSharedDb } from "../src/db/index.js";
import { upsertDeployments, readDeployments } from "../src/github/deployments.js";
import type { StoredDeployment } from "../src/types/github.js";

function makeDeployment(overrides: Partial<StoredDeployment> & Pick<StoredDeployment, "id" | "created_at">): StoredDeployment {
  return {
    repo: "myrepo",
    owner: "myorg",
    environment: "production",
    status: "success",
    sha: "abc123",
    ref: "main",
    creator: "alice",
    description: "Deploy v1.0",
    caused_incident: 0,
    completed_at: null,
    team: null,
    fetched_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("Deployment store/query roundtrip", () => {
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
    tempDir = mkdtempSync(join(tmpdir(), "team-data-deployments-test-"));
    dbPath = join(tempDir, "test.db");
    getSharedDb(dbPath);
    return dbPath;
  }

  it("upsertDeployments roundtrip: inserts 3 deployments and reads them back", () => {
    const path = freshDb();
    const now = new Date();
    const deployments: StoredDeployment[] = [
      makeDeployment({ id: "myorg/myrepo#deploy-1", created_at: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(), status: "success" }),
      makeDeployment({ id: "myorg/myrepo#deploy-2", created_at: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(), status: "failure" }),
      makeDeployment({ id: "myorg/myrepo#deploy-3", created_at: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(), status: "success", sha: "def456", creator: "bob" }),
    ];

    upsertDeployments(deployments, path);
    const result = readDeployments("myorg", "myrepo", { dbPath: path });

    expect(result).toHaveLength(3);
    const statuses = result.map((r) => r.status).sort();
    expect(statuses).toEqual(["failure", "success", "success"]);
    expect(result.find((r) => r.id === "myorg/myrepo#deploy-3")?.creator).toBe("bob");
  });

  it("upsertDeployments upsert behavior: re-inserting updates status and leaves only 1 row", () => {
    const path = freshDb();
    const deployment = makeDeployment({ id: "myorg/myrepo#deploy-10", created_at: new Date().toISOString(), status: "pending" });
    upsertDeployments([deployment], path);

    const updated = { ...deployment, status: "success" };
    upsertDeployments([updated], path);

    const result = readDeployments("myorg", "myrepo", { dbPath: path });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("success");
  });

  it("readDeployments lookback filter: only returns deployments within the lookback window", () => {
    const path = freshDb();
    const now = new Date();
    const recent = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const old = new Date(now.getTime() - 50 * 24 * 60 * 60 * 1000).toISOString();

    upsertDeployments([
      makeDeployment({ id: "myorg/myrepo#deploy-20", created_at: recent }),
      makeDeployment({ id: "myorg/myrepo#deploy-21", created_at: old }),
    ], path);

    const result = readDeployments("myorg", "myrepo", { lookbackDays: 30, dbPath: path });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("myorg/myrepo#deploy-20");
  });

  it("readDeployments environment filter: returns only deployments for the specified environment", () => {
    const path = freshDb();
    const created_at = new Date().toISOString();
    upsertDeployments([
      makeDeployment({ id: "myorg/myrepo#deploy-30", created_at, environment: "production" }),
      makeDeployment({ id: "myorg/myrepo#deploy-31", created_at, environment: "staging" }),
      makeDeployment({ id: "myorg/myrepo#deploy-32", created_at, environment: "production" }),
    ], path);

    const result = readDeployments("myorg", "myrepo", { environment: "production", dbPath: path });
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.environment === "production")).toBe(true);
  });
});
