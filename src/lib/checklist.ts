/**
 * "Finish setting up": what a new owner still has to do, and how each job is
 * judged finished.
 *
 * The wizard asks three questions and stops there. These are the ones it left,
 * because the honest answers are only the owner's to give — and because none
 * of them should hold up the till while they think about it.
 */

import type { License } from './license';
import type { Settings, User } from './types';

export type ChecklistId = 'printer' | 'address' | 'vat' | 'license' | 'staff';

export interface ChecklistItem {
  id: ChecklistId;
  done: boolean;
  label: string;
  href: string;
}

export interface ChecklistState {
  settings: Settings;
  licensed: License | null;
  users: User[];
}

/** Dismissal is a real answer, not a "not now": a job the owner has retired
 *  stops being asked for good. */
function retired(id: ChecklistId, state: ChecklistState): boolean {
  return state.settings.checklistDismissed.includes(id);
}

/** Each job links to the Settings section that does it. */
const JOBS: {
  id: ChecklistId;
  label: string;
  section: string;
  done: (state: ChecklistState) => boolean;
}[] = [
  // The printer is absent until one is paired, and null is how it is unset.
  {
    id: 'printer',
    label: 'Pair a receipt printer',
    section: 'receipt-printer',
    done: (s) => s.settings.printer != null,
  },
  {
    id: 'address',
    label: 'Add the shop address',
    section: 'business',
    done: (s) => s.settings.address.trim() !== '',
  },
  // Nothing to check against: a business is VAT-registered or it is not, and
  // only the owner knows. Answering it once — the VAT switch in Settings, or
  // "not now" here — retires the question.
  {
    id: 'vat',
    label: 'Confirm whether you are VAT-registered',
    section: 'tax',
    done: (s) => retired('vat', s),
  },
  { id: 'license', label: 'Activate your license', section: 'license', done: (s) => s.licensed !== null },
  {
    id: 'staff',
    label: 'Add the staff who will sign in',
    section: 'users',
    done: (s) => s.users.filter((u) => u.active).length > 1,
  },
];

/** Every job, done or not, in the order the owner meets them. A job the owner
 *  has retired counts as done whichever rule it has: "not now" on the printer
 *  is as final an answer as pairing one. */
export function checklistItems(state: ChecklistState): ChecklistItem[] {
  return JOBS.map(({ id, label, section, done }) => ({
    id,
    done: retired(id, state) || done(state),
    label,
    href: `/settings#${section}`,
  }));
}

/** The id and the "not now" that retires it, in one call. */
export function dismissed(settings: Settings, id: ChecklistId): string[] {
  return settings.checklistDismissed.includes(id)
    ? settings.checklistDismissed
    : [...settings.checklistDismissed, id];
}
