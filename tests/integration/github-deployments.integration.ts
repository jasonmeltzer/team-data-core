import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "fs";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Load fixtures at module scope (before vi.mock hoisting)
const deploymentsFixture = JSON.parse(
  readFileSync(join(import.meta.dirname, "../fixtures/github/deployments-list.json"), "utf-8")
);
const deploymentStatusesFixture = JSON.parse(
  readFileSync(join(import.meta.dirname, "../fixtures/github/deployment-statuses.json"), "utf-8")
);
const releasesFixture = JSON.parse(
  readFileSync(join(import.meta.dirname, "../fixtures/github/releases-list.json"), "utf-8")
);

const LIVE = process.env.INTEGRATION_LIVE === "true";

// Configurable mock implementations — swapped per describe block in beforeAll.
// Using module-level mutable functions so that vi.mock factory (which is hoisted)
// can reference variables that we set later from beforeAll.
let mockListDeployments = vi.fn().mockResolvedValue({ data: deploymentsFixture });
let mockListDeploymentStatuses = vi.fn().mockResolvedValue({ data: deploymentStatusesFixture });
let mockListReleases = vi.fn().mockResolvedValue({ data: releasesFixture });

vi.mock("octokit", () => {
  function OctokitMock(this: unknown) {
    return {
      rest: {
        repos: {
          listDeployments: (args: unknown) => mockListDeployments(args),
          listDeploymentStatuses: (args: unknown) => mockListDeploymentStatuses(args),
          listReleases: (args: unknown) => mockListReleases(args),
        },
      },
    };
  }

  return { Octokit: OctokitMock };
});

// ──────────────────────────────────────────────────────────────────────────────
// Describe block 1: source="deployments"
// ──────────────────────────────────────────────────────────────────────────────
describe('GitHub deployments integration: source="deployments"', () => {
  let tempDir: string;
  let dbPath: string;

  beforeAll(async () => {
    if (LIVE) return;

    // Reset mocks to deployments fixture behavior
    mockListDeployments = vi.fn().mockResolvedValue({ data: deploymentsFixture });
    mockListDeploymentStatuses = vi.fn().mockResolvedValue({ data: deploymentStatusesFixture });
    mockListReleases = vi.fn().mockResolvedValue({ data: [] });

    tempDir = mkdtempSync(join(tmpdir(), "team-data-deploys-integration-"));
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
  });

  it("fetchAndStoreDeployments returns correct count", async () => {
    const { fetchAndStoreDeployments } = await import("../../src/github/deployments.js");
    const result = await fetchAndStoreDeployments("test-token", "testorg", "testrepo", {
      source: "deployments",
      lookbackDays: 365,
      dbPath,
    });

    expect(result.deploymentCount).toBe(2);
  });

  it("stored deployments queried back with correct values", async () => {
    const { readDeployments } = await import("../../src/github/deployments.js");
    const deploys = readDeployments("testorg", "testrepo", { lookbackDays: 365, dbPath });

    expect(deploys).toHaveLength(2);

    // Spot-check first deployment (sorted desc by created_at, so 5001 comes first)
    const deploy5001 = deploys.find((d) => d.id === "testorg/testrepo#deploy-5001");
    expect(deploy5001?.sha).toBe("aaa111bbb222");
    expect(deploy5001?.status).toBe("success");
    expect(deploy5001?.environment).toBe("production");
  });

  it("stored deployments have correct shape", async () => {
    const { readDeployments } = await import("../../src/github/deployments.js");
    const deploys = readDeployments("testorg", "testrepo", { lookbackDays: 365, dbPath });

    for (const d of deploys) {
      expect(typeof d.id).toBe("string");
      expect(typeof d.caused_incident).toBe("number");
      expect(typeof d.created_at).toBe("string");
      expect(d.created_at.length).toBeGreaterThan(0);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Describe block 2: source="releases"
// ──────────────────────────────────────────────────────────────────────────────
describe('GitHub deployments integration: source="releases"', () => {
  let tempDir: string;
  let dbPath: string;

  beforeAll(async () => {
    if (LIVE) return;

    // Reset mocks to releases fixture behavior
    mockListDeployments = vi.fn().mockResolvedValue({ data: [] });
    mockListDeploymentStatuses = vi.fn().mockResolvedValue({ data: [] });
    mockListReleases = vi.fn().mockResolvedValue({ data: releasesFixture });

    // Fresh DB — independent from the deployments describe block
    tempDir = mkdtempSync(join(tmpdir(), "team-data-releases-integration-"));
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

  it("fetchAndStoreDeployments with releases source returns correct count", async () => {
    const { fetchAndStoreDeployments } = await import("../../src/github/deployments.js");
    const result = await fetchAndStoreDeployments("test-token", "testorg", "testrepo", {
      source: "releases",
      lookbackDays: 365,
      dbPath,
    });

    expect(result.deploymentCount).toBe(2);
  });

  it("releases stored as deployments with correct values", async () => {
    const { readDeployments } = await import("../../src/github/deployments.js");
    const deploys = readDeployments("testorg", "testrepo", { lookbackDays: 365, dbPath });

    expect(deploys).toHaveLength(2);

    // Spot-check: releases are mapped to deployments with ref=tag_name, description=name
    const release7001 = deploys.find((d) => d.id === "testorg/testrepo#release-7001");
    expect(release7001?.ref).toBe("v1.2.0");
    expect(release7001?.environment).toBe("production");
    expect(release7001?.description).toBe("Release v1.2.0");
  });
});
