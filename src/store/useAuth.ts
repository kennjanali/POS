'use client';

import { create } from 'zustand';

import { verifyPin } from '@/lib/crypto';
import type { Role, User } from '@/lib/types';

/**
 * Who is signed in, right now, on this tab.
 *
 * Deliberately not in IndexedDB: closing the tab has to sign you out. The
 * session lives in memory and mirrors to sessionStorage so a refresh mid-shift
 * doesn't send the waiter back to the keypad.
 *
 * The failed-attempt counter is the one thing that goes to localStorage. It is
 * not secret, and a lockout you can clear by pressing F5 is not a lockout.
 */

export const MAX_ATTEMPTS = 5;
export const LOCK_MS = 30_000;

const SESSION_KEY = 'kramgen.session';
const LOCKOUT_KEY = 'kramgen.lockout';

export interface Session {
  userId: string;
  name: string;
  role: Role;
  signedInAt: number;
}

export type SignInResult =
  | { ok: true; user: User }
  | { ok: false; reason: 'locked' | 'invalid'; lockedUntil: number | null };

interface AuthState {
  session: Session | null;
  /** False until the session has been read back from sessionStorage. */
  hydrated: boolean;
  failed: number;
  lockedUntil: number | null;

  hydrate: () => void;
  signIn: (pin: string, users: User[]) => Promise<SignInResult>;
  /** Re-read the signed-in user from the users list. Deactivate or demote
   *  someone mid-shift and their open tab has to notice. */
  refresh: (user: User | undefined) => void;
  lock: () => void;
}

// Storage can throw in private-mode browsers. A lost session or lockout is a
// nuisance, not a reason to take the till down.
function readStore(storage: Storage | undefined, key: string): unknown {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStore(storage: Storage | undefined, key: string, value: unknown): void {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, JSON.stringify(value));
  } catch {
    /* nothing sensible to do; the session simply won't survive a refresh */
  }
}

function isSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false;
  const s = value as Partial<Session>;
  return typeof s.userId === 'string' && typeof s.name === 'string' && !!s.role;
}

export const useAuth = create<AuthState>()((set, get) => ({
  session: null,
  hydrated: false,
  failed: 0,
  lockedUntil: null,

  hydrate: () => {
    if (typeof window === 'undefined') return;
    const stored = readStore(window.sessionStorage, SESSION_KEY);
    const lockout = readStore(window.localStorage, LOCKOUT_KEY) as {
      failed?: number;
      lockedUntil?: number | null;
    } | null;

    set({
      session: isSession(stored) ? stored : null,
      failed: lockout?.failed ?? 0,
      lockedUntil: lockout?.lockedUntil ?? null,
      hydrated: true,
    });
  },

  signIn: async (pin, users) => {
    const now = Date.now();
    const { lockedUntil } = get();
    if (lockedUntil && lockedUntil > now) {
      return { ok: false, reason: 'locked', lockedUntil };
    }

    // An expired lock clears the counter — five fresh tries after the wait.
    const failedBefore = lockedUntil ? 0 : get().failed;

    // No usernames, so the PIN is the lookup. Deactivated users never match;
    // their PIN stays reserved (see usePos.pinInUse) so it can't be handed out
    // to somebody else while their name is still on the audit trail.
    let matched: User | null = null;
    for (const user of users) {
      if (!user.active) continue;
      if (await verifyPin(pin, user.pin)) {
        matched = user;
        break;
      }
    }

    if (!matched) {
      const failed = failedBefore + 1;
      const locked = failed >= MAX_ATTEMPTS ? now + LOCK_MS : null;
      set({ failed, lockedUntil: locked });
      writeStore(window.localStorage, LOCKOUT_KEY, { failed, lockedUntil: locked });
      return { ok: false, reason: locked ? 'locked' : 'invalid', lockedUntil: locked };
    }

    const session: Session = {
      userId: matched.id,
      name: matched.name,
      role: matched.role,
      signedInAt: now,
    };
    set({ session, failed: 0, lockedUntil: null });
    writeStore(window.sessionStorage, SESSION_KEY, session);
    writeStore(window.localStorage, LOCKOUT_KEY, null);
    return { ok: true, user: matched };
  },

  refresh: (user) => {
    const { session } = get();
    if (!session) return;
    if (!user || !user.active) {
      get().lock();
      return;
    }
    if (user.role === session.role && user.name === session.name) return;
    const next: Session = { ...session, role: user.role, name: user.name };
    set({ session: next });
    writeStore(window.sessionStorage, SESSION_KEY, next);
  },

  /** Step away from the till. Nothing is wiped — open orders stay open. */
  lock: () => {
    set({ session: null });
    writeStore(window.sessionStorage, SESSION_KEY, null);
  },
}));

/** The signed-in user id, for stamping a record with who did it. Reads state
 *  directly so store mutations don't all need an actor argument threaded in. */
export function actorId(): string | null {
  return useAuth.getState().session?.userId ?? null;
}
