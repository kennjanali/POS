/**
 * Customer logins for the website. No outside auth service: passwords are
 * PBKDF2-SHA256 hashes, and a session is a random token in an HttpOnly
 * cookie, of which only the hash is stored.
 */

import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

import type { Env } from './env';

/** The most PBKDF2 rounds Workers allows. */
const ROUNDS = 100_000;
const COOKIE = 'pos034_session';
const SESSION_DAYS = 30;
const DAY = 86_400_000;

export interface Account {
  id: number;
  email: string;
  owner_name: string;
  business_name: string;
  mobile: string;
  city: string;
  status: 'pending' | 'approved';
  license_id: string | null;
  created_at: number;
}

const hex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (text: string) => new Uint8Array(text.match(/../g)?.map((h) => parseInt(h, 16)) ?? []);

export const sha256 = async (text: string) =>
  hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

/** A random token for a cookie or a reset link. */
export const newToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, rounds: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, key, 256));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${ROUNDS}$${hex(salt)}$${await pbkdf2(password, salt, ROUNDS)}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [scheme, rounds, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2-sha256' || !rounds || !salt || !hash) return false;
  return (await pbkdf2(password, unhex(salt), Number(rounds))) === hash;
}

export async function startSession(c: Context<{ Bindings: Env }>, accountId: number) {
  const token = newToken();
  await c.env.DB.prepare('INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), accountId, Date.now() + SESSION_DAYS * DAY)
    .run();
  setCookie(c, COOKIE, token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86_400 });
}

/** The logged-in account, or null. */
export async function currentAccount(c: Context<{ Bindings: Env }>): Promise<Account | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  return c.env.DB.prepare(
    `SELECT a.id, a.email, a.owner_name, a.business_name, a.mobile, a.city, a.status, a.license_id, a.created_at
     FROM sessions s JOIN accounts a ON a.id = s.account_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256(token), Date.now())
    .first<Account>();
}

export async function endSession(c: Context<{ Bindings: Env }>) {
  const token = getCookie(c, COOKIE);
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  deleteCookie(c, COOKIE, { path: '/', secure: true });
}
