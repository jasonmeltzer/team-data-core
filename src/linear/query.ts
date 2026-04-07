import { getSharedDb } from "../db/index.js";
import type { StoredLinearIssue, StoredLinearCycle, StoredLinearTeam } from "../types/linear.js";

export function readLinearIssues(
  teamId: string,
  options: { lookbackDays?: number; stateType?: string; dbPath?: string } = {}
): StoredLinearIssue[] {
  const { lookbackDays, stateType, dbPath } = options;
  const db = getSharedDb(dbPath);

  const conditions: string[] = ["team_id = ?"];
  const params: unknown[] = [teamId];

  if (lookbackDays != null) {
    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
    conditions.push("updated_at >= ?");
    params.push(since);
  }

  if (stateType != null) {
    conditions.push("state_type = ?");
    params.push(stateType);
  }

  const sql = `SELECT * FROM linear_issues WHERE ${conditions.join(" AND ")} ORDER BY updated_at DESC`;
  return db.prepare(sql).all(...params) as StoredLinearIssue[];
}

export function readLinearCycles(
  teamId: string,
  options: { lookbackDays?: number; dbPath?: string } = {}
): StoredLinearCycle[] {
  const { lookbackDays, dbPath } = options;
  const db = getSharedDb(dbPath);

  const conditions: string[] = ["team_id = ?"];
  const params: unknown[] = [teamId];

  if (lookbackDays != null) {
    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
    conditions.push("ends_at >= ?");
    params.push(since);
  }

  const sql = `SELECT * FROM linear_cycles WHERE ${conditions.join(" AND ")} ORDER BY starts_at DESC`;
  return db.prepare(sql).all(...params) as StoredLinearCycle[];
}

export function readLinearTeams(dbPath?: string): StoredLinearTeam[] {
  const db = getSharedDb(dbPath);
  return db.prepare("SELECT * FROM linear_teams ORDER BY name ASC").all() as StoredLinearTeam[];
}
