// Gestion de usuarios del dashboard (sin UI de administracion — CLI directa
// contra Neon). Uso:
//
//   node scripts/manage-user.js create <email> <admin|commercial> ["Nombre visible"]
//   node scripts/manage-user.js deactivate <email>
//   node scripts/manage-user.js activate <email>
//   node scripts/manage-user.js reset-password <email>
//   node scripts/manage-user.js list
//
// Lee DATABASE_URL de .env.local (mismo Neon que usa la app — no crea nada
// nuevo). La contrasena generada se imprime UNA SOLA VEZ por consola —
// nunca se guarda en texto plano en ningun sitio, solo su hash bcrypt.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { neon } = require("@neondatabase/serverless");

function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvLocal();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Falta DATABASE_URL (revisa .env.local, o exportala antes de ejecutar el script).");
  process.exit(1);
}
const sql = neon(DATABASE_URL);

const CHARSET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sin 0/O/1/l/I
function generatePassword(length = 14) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += CHARSET[bytes[i] % CHARSET.length];
  return out;
}

async function ensureSchema() {
  const schemaSql = fs.readFileSync(path.join(__dirname, "..", "db", "auth-schema.sql"), "utf8");
  const statements = schemaSql.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
  for (const stmt of statements) await sql.query(stmt);
}

async function cmdCreate(email, role, displayName) {
  if (!email || !["admin", "commercial"].includes(role)) {
    console.error('Uso: node scripts/manage-user.js create <email> <admin|commercial> ["Nombre visible"]');
    process.exit(1);
  }
  await ensureSchema();
  const existing = await sql`select id from dashboard_users where lower(email) = ${email.toLowerCase()} limit 1`;
  if (existing.length > 0) {
    console.error(`Ya existe un usuario con ese email: ${email}`);
    process.exit(1);
  }
  const password = generatePassword();
  const hash = await bcrypt.hash(password, 12);
  const id = crypto.randomUUID();
  await sql`insert into dashboard_users (id, email, password_hash, role, display_name, active)
            values (${id}, ${email.toLowerCase()}, ${hash}, ${role}, ${displayName || null}, true)`;
  console.log("\nUsuario creado:");
  console.log(`  email:    ${email}`);
  console.log(`  role:     ${role}`);
  console.log(`  password: ${password}`);
  console.log("\nEntregasela a la persona por un canal seguro (no queda guardada en ningun sitio mas que este print).\n");
}

async function cmdSetActive(email, active) {
  await ensureSchema();
  const rows = await sql`update dashboard_users set active = ${active}, updated_at = now()
                          where lower(email) = ${email.toLowerCase()} returning email, role, active`;
  if (rows.length === 0) {
    console.error(`No existe ningun usuario con ese email: ${email}`);
    process.exit(1);
  }
  console.log(`${email} -> active = ${rows[0].active}`);
}

async function cmdResetPassword(email) {
  await ensureSchema();
  const password = generatePassword();
  const hash = await bcrypt.hash(password, 12);
  const rows = await sql`update dashboard_users set password_hash = ${hash}, updated_at = now()
                          where lower(email) = ${email.toLowerCase()} returning email`;
  if (rows.length === 0) {
    console.error(`No existe ningun usuario con ese email: ${email}`);
    process.exit(1);
  }
  console.log(`\nContrasena nueva para ${email}:`);
  console.log(`  ${password}\n`);
}

async function cmdList() {
  await ensureSchema();
  const rows = await sql`select email, role, active, display_name, created_at from dashboard_users order by created_at asc`;
  if (rows.length === 0) {
    console.log("No hay usuarios todavia.");
    return;
  }
  for (const r of rows) {
    console.log(`${r.active ? "✓" : "✗"} ${r.email.padEnd(30)} ${r.role.padEnd(11)} ${r.display_name ?? ""}`);
  }
}

async function main() {
  const [, , cmd, ...args] = process.argv;
  if (cmd === "create") await cmdCreate(args[0], args[1], args[2]);
  else if (cmd === "deactivate") await cmdSetActive(args[0], false);
  else if (cmd === "activate") await cmdSetActive(args[0], true);
  else if (cmd === "reset-password") await cmdResetPassword(args[0]);
  else if (cmd === "list") await cmdList();
  else {
    console.log(`Uso:
  node scripts/manage-user.js create <email> <admin|commercial> ["Nombre visible"]
  node scripts/manage-user.js deactivate <email>
  node scripts/manage-user.js activate <email>
  node scripts/manage-user.js reset-password <email>
  node scripts/manage-user.js list`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
