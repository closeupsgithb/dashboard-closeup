import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
import { join } from "path";

// Mismo DATABASE_URL/proyecto Neon que lib/growth/db.ts — una tabla mas
// (dashboard_users), no una base de datos distinta. Mismo patron de
// "ensureSchema perezoso en el primer query de cada invocacion fria".
function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("MISSING_DATABASE_URL");
  return neon(url);
}

let schemaEnsured = false;
export async function ensureAuthSchema(): Promise<void> {
  if (schemaEnsured) return;
  const db = sql();
  const schemaSql = readFileSync(join(process.cwd(), "db", "auth-schema.sql"), "utf8");
  const statements = schemaSql
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await db.query(statement);
  }
  schemaEnsured = true;
}

export async function authQuery<T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> {
  await ensureAuthSchema();
  const db = sql();
  return db(strings, ...values) as unknown as Promise<T[]>;
}
