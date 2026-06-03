#!/usr/bin/env node
/**
 * scripts/make-password-sql.mjs
 *
 * Generate the UPDATE statement that sets a user's password in
 * u1d_ops.users. Hash format matches src/lib/auth/password.ts
 * (scrypt$<saltHex>$<keyHex>, 64-byte key).
 *
 * Usage:
 *   node scripts/make-password-sql.mjs <email> <password>
 *
 * Then paste the printed SQL into psql (railway connect Postgres).
 * Nothing is written to the database by this script, and the password
 * is never stored or transmitted — only its scrypt hash appears in the SQL.
 */
import { scryptSync, randomBytes } from "node:crypto";

const [, , email, password] = process.argv;

if (!email || !password) {
  console.error("Usage: node scripts/make-password-sql.mjs <email> <password>");
  process.exit(1);
}

const salt = randomBytes(16);
const key = scryptSync(password, salt, 64);
const hash = `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
const safeEmail = email.replace(/'/g, "''");

console.log(
  `UPDATE u1d_ops.users SET password_hash = '${hash}' WHERE LOWER(email) = LOWER('${safeEmail}');`
);
