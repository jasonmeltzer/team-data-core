import type Database from "better-sqlite3";

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pull_requests (
      id           TEXT PRIMARY KEY,
      repo         TEXT NOT NULL,
      owner        TEXT NOT NULL,
      number       INTEGER NOT NULL,
      title        TEXT NOT NULL,
      author       TEXT NOT NULL,
      state        TEXT NOT NULL,
      is_draft     INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      merged_at    TEXT,
      closed_at    TEXT,
      additions    INTEGER NOT NULL DEFAULT 0,
      deletions    INTEGER NOT NULL DEFAULT 0,
      team         TEXT,
      fetched_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_prs_repo ON pull_requests(repo, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_prs_owner_repo ON pull_requests(owner, repo, updated_at DESC);

    CREATE TABLE IF NOT EXISTS reviews (
      id           TEXT PRIMARY KEY,
      pr_id        TEXT NOT NULL,
      reviewer     TEXT NOT NULL,
      avatar_url   TEXT,
      state        TEXT NOT NULL,
      submitted_at TEXT NOT NULL,
      fetched_at   TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (pr_id) REFERENCES pull_requests(id)
    );
    CREATE INDEX IF NOT EXISTS idx_reviews_pr ON reviews(pr_id);

    CREATE TABLE IF NOT EXISTS deployments (
      id           TEXT PRIMARY KEY,
      repo         TEXT NOT NULL,
      owner        TEXT NOT NULL,
      environment  TEXT NOT NULL DEFAULT 'production',
      status       TEXT NOT NULL,
      sha          TEXT,
      ref          TEXT,
      creator      TEXT,
      description  TEXT,
      caused_incident INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL,
      completed_at TEXT,
      team         TEXT,
      fetched_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_deploys_repo ON deployments(repo, created_at DESC);

    CREATE TABLE IF NOT EXISTS linear_issues (
      id           TEXT PRIMARY KEY,
      identifier   TEXT NOT NULL,
      team_id      TEXT NOT NULL,
      team_name    TEXT NOT NULL,
      title        TEXT NOT NULL,
      state_name   TEXT NOT NULL,
      state_type   TEXT NOT NULL,
      assignee     TEXT,
      estimate     REAL,
      priority     INTEGER,
      url          TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      started_at   TEXT,
      completed_at TEXT,
      due_date     TEXT,
      fetched_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_li_issues_team ON linear_issues(team_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_li_issues_state ON linear_issues(state_type);

    CREATE TABLE IF NOT EXISTS linear_cycles (
      id           TEXT PRIMARY KEY,
      team_id      TEXT NOT NULL,
      name         TEXT,
      number       INTEGER NOT NULL,
      starts_at    TEXT NOT NULL,
      ends_at      TEXT NOT NULL,
      progress     REAL NOT NULL DEFAULT 0,
      fetched_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_li_cycles_team ON linear_cycles(team_id, starts_at DESC);

    CREATE TABLE IF NOT EXISTS linear_teams (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      key          TEXT NOT NULL,
      fetched_at   TEXT NOT NULL
    );
  `);
}
