# team-data-core

Shared data fetching and SQLite storage for engineering tools. Pulls data from GitHub and Linear APIs into a local SQLite database that multiple applications can read from.

## What it does

- **Fetches** pull requests, reviews, deployments, Linear issues, cycles, and teams from their respective APIs
- **Stores** everything in a shared SQLite database using upsert (INSERT OR REPLACE) semantics
- **Queries** with typed functions that filter by repo, team, lookback window, state, and environment

## Who uses it

| App | Role |
|-----|------|
| [team-health-dashboard](https://github.com/jasonmeltzer/team-health-dashboard) | Fetches data (write path) + reads for metrics computation |
| [ai-org-copilot](https://github.com/jasonmeltzer/ai-org-copilot) | Reads shared data (read path) for AI analysis |

## Tech stack

- **TypeScript** — strict mode, dual ESM/CJS output via tsup
- **better-sqlite3** — synchronous SQLite with WAL mode
- **Octokit** — GitHub REST API client
- **Raw fetch** — Linear GraphQL API (no SDK)
- **Vitest** — unit tests

## Quick start

```bash
# Build
npm install
npm run build

# Test
npm test

# Watch mode
npm run dev
```

## Project structure

```
src/
├── index.ts              # Public API re-exports
├── db/
│   ├── index.ts          # DB singleton (getSharedDb) with WAL mode
│   └── schema.ts         # 6-table schema (initSchema)
├── github/
│   ├── fetch.ts          # fetchAndStorePRs (Octokit, pagination, early termination)
│   ├── store.ts          # upsertPRs, upsertReviews (batch transactions)
│   ├── query.ts          # readPRs, readReviewsForPR, readReviewsForRepo
│   ├── deployments.ts    # fetchAndStoreDeployments (auto-detect source), readDeployments
│   └── index.ts          # Barrel re-exports
├── linear/
│   ├── fetch.ts          # fetchAndStoreLinearIssues, fetchAndStoreLinearCycles (GraphQL)
│   ├── store.ts          # upsertLinearIssues, upsertLinearCycles, upsertLinearTeam
│   ├── query.ts          # readLinearIssues, readLinearCycles, readLinearTeams
│   └── index.ts          # Barrel re-exports
└── types/
    ├── github.ts         # StoredPR, StoredReview, StoredDeployment
    └── linear.ts         # StoredLinearIssue, StoredLinearCycle, StoredLinearTeam
tests/
├── db.test.ts            # Schema creation, WAL mode, table existence
├── github.test.ts        # PR/review upsert roundtrips, lookback/state filtering
├── linear.test.ts        # Issue/cycle/team upsert roundtrips, team/stateType filtering
└── deployments.test.ts   # Deployment upsert roundtrips, lookback/environment filtering
```

## Shared database

Default location: `~/.local/share/team-data/data.db`

Override with `TEAM_DATA_DB` environment variable or the `dbPath` parameter on any function.

### Tables

| Table | Primary key format | Description |
|-------|-------------------|-------------|
| `pull_requests` | `owner/repo#number` | GitHub PRs with state, author, dates, diff stats |
| `reviews` | `owner/repo#pr#review_id` | PR reviews with reviewer, state, timestamp |
| `deployments` | `owner/repo#source-id` | Deployments from API, releases, or merged PRs |
| `linear_issues` | Linear UUID | Issues with state, assignee, estimates, dates |
| `linear_cycles` | Linear UUID | Sprint cycles with dates and progress |
| `linear_teams` | Linear UUID | Team metadata (name, key) |

## Design principles

- **Credentials as parameters** — API tokens are never read from env vars inside the package. The caller passes them explicitly.
- **No caching** — query functions hit SQLite directly. Caching is the consumer's responsibility.
- **No metrics computation** — the package stores raw data. Scoring, DORA metrics, and health calculations stay in the consuming apps.
- **Upsert semantics** — all writes use INSERT OR REPLACE, so re-fetching the same data is safe and idempotent.

## Integration

See [INTEGRATION.md](INTEGRATION.md) for detailed setup instructions, API reference, full schema documentation, and architecture notes.

## License

MIT
