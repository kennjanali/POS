/**
 * First-use tips: which ones a user has already seen.
 *
 * Kept in localStorage under `pos034.tips.<userId>`, a list of tip ids. It is
 * a convenience, not a record: private windows, cleared site data and blocked
 * storage all throw or come back empty, and then no tip shows at all rather
 * than the same one showing forever.
 */

/** The part of Storage this needs, so a test can hand in its own. */
export type TipStorage = Pick<Storage, 'getItem' | 'setItem'>;

const key = (userId: string) => `pos034.tips.${userId}`;

/** The tips this user has seen, or null when storage cannot be used. */
export function seenTips(storage: TipStorage | null, userId: string): string[] | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return null;
  }
}

/**
 * True if this tip should show now. Showing it marks it seen, so it never
 * shows again for this user. False whenever storage cannot be read or written.
 */
export function takeTip(storage: TipStorage | null, userId: string, id: string): boolean {
  const seen = seenTips(storage, userId);
  if (seen === null || seen.includes(id)) return false;
  try {
    storage!.setItem(key(userId), JSON.stringify([...seen, id]));
  } catch {
    return false;
  }
  return true;
}
