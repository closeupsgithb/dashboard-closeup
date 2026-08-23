import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
import { join } from "path";

export class MissingCredentialsError extends Error {
  constructor() {
    super("MISSING_CREDENTIALS");
  }
}

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new MissingCredentialsError();
  return neon(url);
}

// Se ejecuta (idempotente, CREATE ... IF NOT EXISTS) en el primer acceso de
// cada invocación fría en vez de depender de un paso de migración aparte —
// mismo espíritu que el resto del proyecto (sin ORM, sin herramienta de
// migraciones), y barato de repetir porque no hace nada si ya existe.
let schemaEnsured = false;
export async function ensureSchema(): Promise<void> {
  if (schemaEnsured) return;
  const db = sql();
  const schemaSql = readFileSync(join(process.cwd(), "db", "growth-schema.sql"), "utf8");
  const statements = schemaSql
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await db.query(statement);
  }
  schemaEnsured = true;
}

export async function query<T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> {
  await ensureSchema();
  const db = sql();
  return db(strings, ...values) as unknown as Promise<T[]>;
}
