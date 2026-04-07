import { getSharedDb } from "../db/index.js";
import type { StoredLinearIssue, StoredLinearCycle, StoredLinearTeam } from "../types/linear.js";

export function upsertLinearIssues(issues: StoredLinearIssue[], dbPath?: string): void {
  if (issues.length === 0) return;
  const db = getSharedDb(dbPath);
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO linear_issues
      (id, identifier, team_id, team_name, title, state_name, state_type,
       assignee, estimate, priority, url, created_at, updated_at,
       started_at, completed_at, due_date, fetched_at)
    VALUES
      (@id, @identifier, @team_id, @team_name, @title, @state_name, @state_type,
       @assignee, @estimate, @priority, @url, @created_at, @updated_at,
       @started_at, @completed_at, @due_date, @fetched_at)
  `);
  const insertMany = db.transaction((rows: StoredLinearIssue[]) => {
    for (const row of rows) {
      stmt.run(row);
    }
  });
  insertMany(issues);
}

export function upsertLinearCycles(cycles: StoredLinearCycle[], dbPath?: string): void {
  if (cycles.length === 0) return;
  const db = getSharedDb(dbPath);
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO linear_cycles
      (id, team_id, name, number, starts_at, ends_at, progress, fetched_at)
    VALUES
      (@id, @team_id, @name, @number, @starts_at, @ends_at, @progress, @fetched_at)
  `);
  const insertMany = db.transaction((rows: StoredLinearCycle[]) => {
    for (const row of rows) {
      stmt.run(row);
    }
  });
  insertMany(cycles);
}

export function upsertLinearTeam(team: StoredLinearTeam, dbPath?: string): void {
  const db = getSharedDb(dbPath);
  db.prepare(`
    INSERT OR REPLACE INTO linear_teams
      (id, name, key, fetched_at)
    VALUES
      (@id, @name, @key, @fetched_at)
  `).run(team);
}
