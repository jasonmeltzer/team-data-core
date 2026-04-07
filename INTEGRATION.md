# team-data-core Integration Guide

A shared package for fetching GitHub and Linear data into a SQLite database that multiple Next.js applications can read from.

---

## Overview

`team-data-core` provides a two-step data pipeline:

1. **Write path (fetch-and-store):** A consuming application fetches data from GitHub and Linear APIs and stores it in a shared SQLite database.
2. **Read path (query functions):** Any application can read from the same database using typed query functions — no API credentials needed for reads.

Both applications share the same database file, configured via the `TEAM_DATA_DB` environment variable or the `dbPath` parameter.

---

## Getting Started

### 1. Install

From your project root, add `team-data-core` as a file dependency:

```bash
# In your package.json:
"team-data-core": "file:../team-data-core"

# Then install:
npm install
```

Then ensure transitive dependencies are installed. Even if you only use query functions (read path), the CJS bundle imports all modules at load time, so `octokit` and `better-sqlite3` must be resolvable:

```bash
npm install octokit better-sqlite3
```

**Turbopack symlink workaround:** Turbopack (Next.js bundler) rejects modules whose real path is outside the project root. `npm link` creates symlinks that fail this check. Copy the dist files directly into `node_modules` instead:

```bash
mkdir -p node_modules/team-data-core
cp -r ../team-data-core/dist node_modules/team-data-core/
cp ../team-data-core/package.json node_modules/team-data-core/
```

### 2. Configure Next.js

Add `team-data-core` to `serverExternalPackages` in your `next.config.ts` (or `next.config.mjs`). This tells Next.js to treat it as a server-only runtime external — not bundled by Webpack or Turbopack.

```typescript
// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "team-data-core"],
};

export default nextConfig;
```

> **Note:** This is the top-level `serverExternalPackages` key (Next.js 15+). The old `experimental.serverComponentsExternalPackages` was renamed in Next.js 15/16.

### 3. Set the DB path

The shared database file is configurable via environment variable:

```bash
# .env.local
TEAM_DATA_DB=/path/to/shared/data.db
```

Default path when `TEAM_DATA_DB` is not set: `~/.local/share/team-data/data.db`

The database is created automatically on first write. It is **not** created on read — if the file doesn't exist, query functions will throw.

---

## Fetch Data (Write Path)

The upstream application calls fetch-and-store functions from API routes to refresh the shared DB. These functions require API credentials (token, API key) as parameters — credentials are never stored in the package.

### GitHub

```typescript
import { fetchAndStorePRs, fetchAndStoreDeployments } from "team-data-core";

// Fetch PRs and reviews for a repository
const { prCount, reviewCount } = await fetchAndStorePRs(
  process.env.GITHUB_TOKEN!,
  "my-org",
  "my-repo",
  {
    lookbackDays: 30, // default: 30
    maxPRs: 500,      // default: 500
    dbPath: process.env.TEAM_DATA_DB, // optional, uses default path if omitted
  }
);

// Fetch deployments
const { deploymentCount } = await fetchAndStoreDeployments(
  process.env.GITHUB_TOKEN!,
  "my-org",
  "my-repo",
  {
    lookbackDays: 30,
    environment: "production", // optional filter
    source: "auto",            // "auto" | "deployments" | "releases" | "merges"
    dbPath: process.env.TEAM_DATA_DB,
  }
);
```

### Linear

```typescript
import { fetchAndStoreLinearIssues, fetchAndStoreLinearCycles } from "team-data-core";

// Fetch issues for a team
const { issueCount } = await fetchAndStoreLinearIssues(
  process.env.LINEAR_API_KEY!,
  "team-id",
  {
    lookbackDays: 90,
    dbPath: process.env.TEAM_DATA_DB,
  }
);

// Fetch sprint cycles for a team
const { cycleCount } = await fetchAndStoreLinearCycles(
  process.env.LINEAR_API_KEY!,
  "team-id",
  {
    lookbackDays: 180,
    dbPath: process.env.TEAM_DATA_DB,
  }
);
```

---

## Read Data (Read Path)

Downstream applications use query functions to read from the shared DB. No API credentials required.

### GitHub

```typescript
import { readPRs, readReviewsForRepo, readDeployments } from "team-data-core";
import type { StoredPR, StoredReview, StoredDeployment } from "team-data-core";

// Read pull requests
const prs: StoredPR[] = readPRs("my-org", "my-repo", {
  lookbackDays: 30,
  state: "merged", // "open" | "merged" | "closed" | undefined (all)
  dbPath: process.env.TEAM_DATA_DB,
});

// Read all reviews for a repository
const reviews: StoredReview[] = readReviewsForRepo(
  "my-org",
  "my-repo",
  process.env.TEAM_DATA_DB
);

// Read deployments
const deployments: StoredDeployment[] = readDeployments("my-org", "my-repo", {
  lookbackDays: 30,
  environment: "production",
  dbPath: process.env.TEAM_DATA_DB,
});
```

### Linear

```typescript
import { readLinearIssues, readLinearCycles, readLinearTeams } from "team-data-core";
import type { StoredLinearIssue, StoredLinearCycle, StoredLinearTeam } from "team-data-core";

// Read issues for a team
const issues: StoredLinearIssue[] = readLinearIssues("team-id", {
  lookbackDays: 90,
  stateType: "started", // filter by state type (e.g. "started", "completed")
  dbPath: process.env.TEAM_DATA_DB,
});

// Read cycles for a team
const cycles: StoredLinearCycle[] = readLinearCycles("team-id", {
  lookbackDays: 180,
  dbPath: process.env.TEAM_DATA_DB,
});

// Read all teams stored in the shared DB
const teams: StoredLinearTeam[] = readLinearTeams(process.env.TEAM_DATA_DB);
```

---

## API Reference

### Database

| Function | Signature | Description |
|----------|-----------|-------------|
| `getSharedDb` | `(dbPath?: string) => Database` | Returns the shared `better-sqlite3` DB singleton. Creates file + schema on first call. |

### GitHub

| Function | Signature | Description |
|----------|-----------|-------------|
| `fetchAndStorePRs` | `(token, owner, repo, options?) => Promise<{ prCount, reviewCount }>` | Fetches PRs and reviews from GitHub API, upserts into shared DB. |
| `fetchAndStoreDeployments` | `(token, owner, repo, options?) => Promise<{ deploymentCount }>` | Fetches deployments from GitHub API (auto-detects source), upserts into shared DB. |
| `readPRs` | `(owner, repo, options?) => StoredPR[]` | Reads PRs from shared DB, optionally filtered by lookback and state. |
| `readReviewsForPR` | `(prId, dbPath?) => StoredReview[]` | Reads all reviews for a specific PR by its ID. |
| `readReviewsForRepo` | `(owner, repo, dbPath?) => StoredReview[]` | Reads all reviews for all PRs in a repository (JOIN query). |
| `readDeployments` | `(owner, repo, options?) => StoredDeployment[]` | Reads deployments from shared DB, optionally filtered by lookback and environment. |

### Linear

| Function | Signature | Description |
|----------|-----------|-------------|
| `fetchAndStoreLinearIssues` | `(apiKey, teamId, options?) => Promise<{ issueCount }>` | Fetches Linear issues for a team, upserts into shared DB. |
| `fetchAndStoreLinearCycles` | `(apiKey, teamId, options?) => Promise<{ cycleCount }>` | Fetches Linear sprint cycles for a team, upserts into shared DB. |
| `readLinearIssues` | `(teamId, options?) => StoredLinearIssue[]` | Reads issues for a team from shared DB, optionally filtered by lookback and state type. |
| `readLinearCycles` | `(teamId, options?) => StoredLinearCycle[]` | Reads sprint cycles for a team from shared DB. |
| `readLinearTeams` | `(dbPath?) => StoredLinearTeam[]` | Reads all teams stored in the shared DB. |

---

## Schema

All 6 tables are created in a single `initSchema` call when `getSharedDb` is first invoked. There are no app-specific tables in the shared DB — each consuming application manages its own database for app-specific state (e.g., score snapshots, UI cache).

### `pull_requests`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | `owner/repo#number` (e.g. `"my-org/api#42"`) |
| `repo` | TEXT | Repository name (e.g. `"api"`) |
| `owner` | TEXT | Organization or user (e.g. `"my-org"`) |
| `number` | INTEGER | PR number |
| `title` | TEXT | PR title |
| `author` | TEXT | GitHub login |
| `state` | TEXT | `"open"` \| `"merged"` \| `"closed"` |
| `is_draft` | INTEGER | 0 or 1 |
| `created_at` | TEXT | ISO 8601 |
| `updated_at` | TEXT | ISO 8601 |
| `merged_at` | TEXT\|NULL | ISO 8601 |
| `closed_at` | TEXT\|NULL | ISO 8601 |
| `additions` | INTEGER | Lines added (0 if unavailable from list API) |
| `deletions` | INTEGER | Lines removed (0 if unavailable from list API) |
| `team` | TEXT\|NULL | Optional team label |
| `fetched_at` | TEXT | ISO 8601 — when row was last written |

### `reviews`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | GitHub review ID |
| `pr_id` | TEXT | FK → `pull_requests.id` |
| `reviewer` | TEXT | GitHub login |
| `avatar_url` | TEXT\|NULL | Reviewer avatar URL |
| `state` | TEXT | `"approved"` \| `"changes_requested"` \| `"commented"` |
| `submitted_at` | TEXT | ISO 8601 |

### `deployments`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | `owner/repo#source-N` (e.g. `"my-org/api#deploy-12345"`) |
| `repo` | TEXT | Repository name |
| `owner` | TEXT | Organization or user |
| `environment` | TEXT | `"production"` \| `"staging"` \| `"development"` |
| `status` | TEXT | `"success"` \| `"failure"` \| `"in_progress"` \| `"cancelled"` |
| `sha` | TEXT\|NULL | Git SHA |
| `ref` | TEXT\|NULL | Git ref (branch/tag) |
| `creator` | TEXT\|NULL | GitHub login of deployer |
| `description` | TEXT\|NULL | Deployment description |
| `caused_incident` | INTEGER | 0 or 1 — set by app after incident correlation |
| `created_at` | TEXT | ISO 8601 |
| `completed_at` | TEXT\|NULL | ISO 8601 |
| `team` | TEXT\|NULL | Optional team label |
| `fetched_at` | TEXT | ISO 8601 |

### `linear_issues`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Linear issue UUID |
| `identifier` | TEXT | Human-readable ID (e.g. `"ENG-42"`) |
| `team_id` | TEXT | Linear team UUID |
| `team_name` | TEXT | Linear team display name |
| `title` | TEXT | Issue title |
| `state_name` | TEXT | Workflow state name (e.g. `"In Progress"`) |
| `state_type` | TEXT | `"unstarted"` \| `"started"` \| `"completed"` \| `"cancelled"` \| `"triage"` |
| `assignee` | TEXT\|NULL | GitHub/Linear login |
| `estimate` | REAL\|NULL | Story point estimate |
| `priority` | INTEGER\|NULL | 0=none, 1=urgent, 2=high, 3=medium, 4=low |
| `url` | TEXT | Linear issue URL |
| `created_at` | TEXT | ISO 8601 |
| `updated_at` | TEXT | ISO 8601 |
| `started_at` | TEXT\|NULL | ISO 8601 |
| `completed_at` | TEXT\|NULL | ISO 8601 |
| `due_date` | TEXT\|NULL | ISO 8601 date |
| `fetched_at` | TEXT | ISO 8601 |

### `linear_cycles`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Linear cycle UUID |
| `team_id` | TEXT | Linear team UUID |
| `name` | TEXT\|NULL | Cycle name (may be null) |
| `number` | INTEGER | Cycle number |
| `starts_at` | TEXT | ISO 8601 |
| `ends_at` | TEXT | ISO 8601 |
| `progress` | REAL | 0.0 – 1.0 completion fraction |
| `fetched_at` | TEXT | ISO 8601 |

### `linear_teams`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Linear team UUID |
| `name` | TEXT | Team display name |
| `key` | TEXT | Team identifier key (e.g. `"ENG"`) |
| `fetched_at` | TEXT | ISO 8601 |

---

## Architecture

### Shared DB vs App DB

| DB | Owner | Tables | Purpose |
|----|-------|--------|---------|
| `~/.local/share/team-data/data.db` (or `TEAM_DATA_DB`) | `team-data-core` | `pull_requests`, `reviews`, `deployments`, `linear_issues`, `linear_cycles`, `linear_teams` | Cross-app shared raw data |
| App-specific DB | Each consuming app | App-specific tables (scores, cache, etc.) | Not shared — each app manages its own |

### Key Design Decisions

**Credentials as parameters, not stored:** API tokens are passed directly to fetch functions. The package never reads from environment variables or config files — credential resolution is the caller's responsibility.

**No caching in the package:** Query functions open the DB, run a query, and return results. Server-side caching (TTL, stale-while-revalidate) is implemented in the consuming application's cache layer.

**`caused_incident` is app-managed:** The `deployments.caused_incident` column defaults to 0. Consuming apps can set it to 1 via a direct `better-sqlite3` write after their own incident correlation logic. This avoids tightly coupling incident detection to the shared package.

**DB singleton on `globalThis`:** `getSharedDb` maintains a singleton at `globalThis.__teamDataDb` so that WAL mode + busy_timeout are applied once per process. In Next.js dev mode with fast refresh, this prevents re-opening the file on every hot reload.

**Turbopack symlink limitation:** Turbopack (Next.js bundler) rejects modules whose real path is outside the project root. `npm link` creates symlinks that fail this check. Copy the `dist/` directory directly into `node_modules/team-data-core/` instead.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TEAM_DATA_DB` | `~/.local/share/team-data/data.db` | Path to the shared SQLite DB file |

---

## Known Limitations

- `additions` and `deletions` on PRs are always 0. The GitHub list API does not return diff stats; a separate per-PR API call would be needed to enrich this data.
- `requested_reviewers` is not stored. The PR list response includes this field but it was not included in the initial schema. Pending reviewers must be inferred from the absence of completed reviews.
- The package has no migration system. If the schema changes, the DB file must be deleted and re-populated (or a migration script written manually).
