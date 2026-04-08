import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { initSchema } from "./schema.js";

const DEFAULT_DB_PATH = join(homedir(), ".local", "share", "team-data", "data.db");

const globalForDb = globalThis as typeof globalThis & {
  __teamDataDb?: Database.Database;
  __teamDataDbPath?: string;
};

export function getSharedDb(dbPath?: string): Database.Database {
  const resolvedPath = dbPath ?? process.env.TEAM_DATA_DB ?? DEFAULT_DB_PATH;
  // If a different path is requested, close the existing connection and open the new one
  if (globalForDb.__teamDataDb && globalForDb.__teamDataDbPath !== resolvedPath) {
    globalForDb.__teamDataDb.close();
    globalForDb.__teamDataDb = undefined;
    globalForDb.__teamDataDbPath = undefined;
  }
  if (!globalForDb.__teamDataDb) {
    mkdirSync(dirname(resolvedPath), { recursive: true });
    globalForDb.__teamDataDb = new Database(resolvedPath);
    globalForDb.__teamDataDb.pragma("journal_mode = WAL");
    globalForDb.__teamDataDb.pragma("busy_timeout = 5000");
    globalForDb.__teamDataDb.pragma("foreign_keys = ON");
    initSchema(globalForDb.__teamDataDb);
    globalForDb.__teamDataDbPath = resolvedPath;
  }
  return globalForDb.__teamDataDb;
}
