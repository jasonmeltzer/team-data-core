# Architecture

## Overview

team-data-core is a shared data layer package that follows a fetch-store-query pattern. Each data domain (GitHub PRs, Linear issues, deployments) has three modules:

```
External API  →  fetch.ts  →  store.ts  →  SQLite DB  →  query.ts  →  Consumer app
                (API call)    (upsert)                    (SELECT)
```

## Data flow

### Write path (upstream app calls fetch functions)

```
team-health-dashboard API route
  → fetchAndStorePRs(token, owner, repo, { lookbackDays })
    → Octokit paginated list (sorted by updated desc, early termination at lookback boundary)
    → Map API response to StoredPR[]
    → upsertPRs() — INSERT OR REPLACE in a transaction
    → Fetch reviews for top 50 PRs via Promise.allSettled
    → upsertReviews()
  → Return { prCount, reviewCount }
```

### Read path (any app calls query functions)

```
ai-org-copilot
  → readPRs(owner, repo, { lookbackDays, state })
    → SELECT from pull_requests with filters
    → Return StoredPR[]
```

No API credentials needed for the read path.

## Database

### Singleton pattern

`getSharedDb(dbPath?)` returns a `better-sqlite3` Database instance cached on `globalThis.__teamDataDb`. First call:

1. Creates the directory (recursive mkdir)
2. Opens the SQLite file
3. Sets `PRAGMA journal_mode = WAL` (concurrent reads during writes)
4. Sets `PRAGMA busy_timeout = 5000` (wait up to 5s if another process holds a lock)
5. Sets `PRAGMA foreign_keys = ON`
6. Runs `initSchema()` to create all 6 tables + indexes

### Path resolution

Priority: `dbPath` parameter > `TEAM_DATA_DB` env var > `~/.local/share/team-data/data.db`

### Schema design decisions

- **Composite string primary keys** (`owner/repo#number`) — unique across repos without auto-increment. Enables upsert via INSERT OR REPLACE.
- **`team` column is nullable** — team-health-dashboard leaves it null; ai-org-copilot populates it via team mapping rules.
- **`caused_incident` defaults to 0** — the DORA module in team-health-dashboard writes back 1 after incident correlation. This keeps incident logic out of the shared package.
- **No app-specific tables** — `health_snapshots`, `cycle_snapshots`, and Prisma-managed tables stay in each app's own database.
- **`state_type` stored raw from Linear** — no derived type column. Apps derive their own status mappings at read time.

## Module structure

### github/

| File | Responsibility |
|------|---------------|
| `fetch.ts` | Creates Octokit from provided token. Paginates PRs with early termination. Fetches reviews via Promise.allSettled. Calls store functions. |
| `store.ts` | `upsertPRs()`, `upsertReviews()` — batch INSERT OR REPLACE in transactions. |
| `query.ts` | `readPRs()` (lookback + state filter), `readReviewsForPR()`, `readReviewsForRepo()` (JOIN). |
| `deployments.ts` | Self-contained fetch/store/query for deployments. Auto-detection waterfall: Deployments API → Releases → Merged PRs. Environment values normalized to lowercase on store. |

### linear/

| File | Responsibility |
|------|---------------|
| `fetch.ts` | Raw GraphQL queries to `https://api.linear.app/graphql`. Cursor-based pagination for issues. Fetches cycles and team metadata. API key passed as parameter. |
| `store.ts` | `upsertLinearIssues()`, `upsertLinearCycles()`, `upsertLinearTeam()` — batch transactions. |
| `query.ts` | `readLinearIssues()` (team + lookback + stateType filter), `readLinearCycles()`, `readLinearTeams()`. |

### db/

| File | Responsibility |
|------|---------------|
| `index.ts` | `getSharedDb()` singleton with WAL mode and configurable path. |
| `schema.ts` | `initSchema()` creates 6 tables + indexes in a single `db.exec()` call. |

### types/

| File | Exports |
|------|---------|
| `github.ts` | `StoredPR`, `StoredReview`, `StoredDeployment` — row types matching SQLite columns. |
| `linear.ts` | `StoredLinearIssue`, `StoredLinearCycle`, `StoredLinearTeam` — row types matching SQLite columns. |

## Build

tsup produces three outputs from `src/index.ts`:

| Output | Format | Purpose |
|--------|--------|---------|
| `dist/index.js` | ESM | Next.js App Router (server components) |
| `dist/index.cjs` | CJS | Node.js scripts, tests |
| `dist/index.d.ts` | TypeScript declarations | Type checking in consumers |

`better-sqlite3` is externalized (not bundled) because it's a native Node.js addon.

## Consumer integration

Consumers add team-data-core as a `file:` dependency and copy dist into node_modules (Turbopack rejects symlinks outside the project root). They must also install `octokit` and `better-sqlite3` as the CJS bundle imports all modules at the top level.

See [INTEGRATION.md](INTEGRATION.md) for full setup instructions.

## What stays in consuming apps

The package deliberately excludes:

- **Metrics computation** — health scores, DORA ratings, cycle time calculations, velocity trends
- **Scope change detection** — Linear cycle history API calls, carry-over classification
- **Caching** — TTL, stale-while-revalidate, rate limit awareness
- **Incident correlation** — matching incidents to deployments (writes back `caused_incident` to shared DB)
- **App-specific persistence** — score snapshots, cycle snapshots, Prisma-managed schemas
