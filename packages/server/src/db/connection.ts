import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, "schema.sql");

export function createDatabase(path: string = ":memory:"): Database {
  const db = new Database(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  const schema = readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema);

  return db;
}
