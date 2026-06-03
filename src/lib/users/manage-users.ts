/**
 * src/lib/users/manage-users.ts
 *
 * Admin user-management operations against u1d_ops.users (the auth allowlist).
 * Node-only (pg + scrypt). Consumed by /api/admin/users.
 *
 * All mutations are idempotent where it makes sense and never touch a user's
 * password unless explicitly asked (setUserPassword).
 */
import { query, queryOne } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";

export type ManagedRole = "viewer" | "admin";

export type ManagedUser = {
  email: string;
  display_name: string | null;
  role: ManagedRole;
  is_active: boolean;
  has_password: boolean;
  last_login_at: string | null;
  created_at: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

export async function listUsers(): Promise<ManagedUser[]> {
  return query<ManagedUser>(
    `SELECT email,
            display_name,
            role,
            is_active,
            (password_hash IS NOT NULL) AS has_password,
            last_login_at,
            created_at
       FROM u1d_ops.users
      ORDER BY is_active DESC, role DESC, email`
  );
}

export async function createUser(
  email: string,
  displayName: string | null,
  role: ManagedRole
): Promise<void> {
  await query(
    `INSERT INTO u1d_ops.users (email, display_name, role, is_active)
     VALUES (LOWER($1), $2, $3, TRUE)
     ON CONFLICT (email) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           role         = EXCLUDED.role,
           is_active    = TRUE`,
    [normalizeEmail(email), displayName, role]
  );
}

export async function setUserRole(email: string, role: ManagedRole): Promise<void> {
  await query(`UPDATE u1d_ops.users SET role = $2 WHERE LOWER(email) = LOWER($1)`, [
    normalizeEmail(email),
    role,
  ]);
}

export async function setUserActive(email: string, active: boolean): Promise<void> {
  await query(`UPDATE u1d_ops.users SET is_active = $2 WHERE LOWER(email) = LOWER($1)`, [
    normalizeEmail(email),
    active,
  ]);
}

export async function setUserPassword(email: string, plain: string): Promise<void> {
  await query(`UPDATE u1d_ops.users SET password_hash = $2 WHERE LOWER(email) = LOWER($1)`, [
    normalizeEmail(email),
    hashPassword(plain),
  ]);
}

export async function clearUserPassword(email: string): Promise<void> {
  await query(`UPDATE u1d_ops.users SET password_hash = NULL WHERE LOWER(email) = LOWER($1)`, [
    normalizeEmail(email),
  ]);
}

export async function deleteUser(email: string): Promise<void> {
  await query(`DELETE FROM u1d_ops.users WHERE LOWER(email) = LOWER($1)`, [
    normalizeEmail(email),
  ]);
}

export async function userExists(email: string): Promise<boolean> {
  const row = await queryOne(`SELECT 1 AS x FROM u1d_ops.users WHERE LOWER(email) = LOWER($1)`, [
    normalizeEmail(email),
  ]);
  return !!row;
}
