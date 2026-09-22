'use client';

import { useState } from 'react';
import { KeyRound, UserPlus } from 'lucide-react';

import { PinPad } from '@/components/auth/PinPad';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/components/ui/cn';
import { fmtDate, fmtTime } from '@/lib/format';
import { ROLES, ROLE_HINTS, ROLE_LABELS } from '@/lib/permissions';
import type { Role, User } from '@/lib/types';
import { usePos } from '@/store/usePos';
import { useAuth } from '@/store/useAuth';

/**
 * Superadmin only — the Settings route itself is guarded, so this component
 * does not repeat the check.
 *
 * Nobody is ever deleted. Orders, stock moves and audit rows carry these ids;
 * a deactivated row keeps the trail readable and keeps the PIN reserved.
 */
export function UserManager() {
  const users = usePos((s) => s.users);
  const addUser = usePos((s) => s.addUser);
  const setUserPin = usePos((s) => s.setUserPin);
  const setUserRole = usePos((s) => s.setUserRole);
  const setUserActive = usePos((s) => s.setUserActive);
  const currentUserId = useAuth((s) => s.session?.userId);

  const [adding, setAdding] = useState(false);
  const [pinTarget, setPinTarget] = useState<User | null>(null);

  function apply(result: { ok: true } | { ok: false; error: string }, done: string) {
    if (result.ok) toast(done, 'success');
    else toast(result.error, 'danger');
    return result.ok;
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] leading-relaxed text-ink-2">
          Six digits, no username — so no two people can share a PIN. Only the hash is
          stored.
        </p>
        <Button size="sm" onClick={() => setAdding(true)}>
          <UserPlus size={14} aria-hidden />
          Add person
        </Button>
      </div>

      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-line text-left text-[10.5px] tracking-wide text-ink-3 uppercase">
            <th className="py-2 pr-3 font-bold">Name</th>
            <th className="py-2 pr-3 font-bold">Role</th>
            <th className="py-2 pr-3 font-bold">Status</th>
            <th className="py-2 pr-3 font-bold">Last signed in</th>
            <th className="py-2 font-bold">PIN</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-b border-line/60">
              <td className="py-2 pr-3 font-semibold">
                {user.name}
                {user.id === currentUserId && (
                  <span className="ml-1.5 text-[10.5px] font-bold tracking-wide text-accent uppercase">
                    You
                  </span>
                )}
              </td>
              <td className="py-2 pr-3">
                <select
                  aria-label={`Role for ${user.name}`}
                  value={user.role}
                  onChange={(e) =>
                    apply(
                      setUserRole(user.id, e.target.value as Role),
                      `${user.name} is now ${ROLE_LABELS[e.target.value as Role]}`,
                    )
                  }
                  className="h-7 rounded-md border border-line bg-raised px-1.5 text-[12px] font-semibold"
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </td>
              <td className="py-2 pr-3">
                <button
                  type="button"
                  onClick={() =>
                    apply(
                      setUserActive(user.id, !user.active),
                      `${user.active ? 'Deactivated' : 'Reactivated'} ${user.name}`,
                    )
                  }
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase',
                    user.active ? 'bg-good/15 text-good' : 'bg-ink-4/25 text-ink-3',
                  )}
                >
                  {user.active ? 'Active' : 'Off'}
                </button>
              </td>
              <td className="py-2 pr-3 text-ink-2">
                {user.lastLoginAt
                  ? `${fmtDate(user.lastLoginAt)} ${fmtTime(user.lastLoginAt)}`
                  : 'Never'}
              </td>
              <td className="py-2">
                <button
                  type="button"
                  onClick={() => setPinTarget(user)}
                  className="flex items-center gap-1.5 rounded p-1 text-ink-3 hover:bg-raised hover:text-ink"
                >
                  <KeyRound size={13} aria-hidden />
                  Change
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {adding && (
        <AddUserModal
          onClose={() => setAdding(false)}
          onCreate={(input) => addUser(input)}
        />
      )}

      {pinTarget && (
        <SetPinModal
          user={pinTarget}
          onClose={() => setPinTarget(null)}
          onSet={(pin) => setUserPin(pinTarget.id, pin)}
        />
      )}
    </>
  );
}

type Outcome = { ok: true } | { ok: false; error: string };

function AddUserModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (input: { name: string; role: Role; pin: string }) => Promise<Outcome>;
}) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('waiter');
  const [step, setStep] = useState<'details' | 'pin'>('details');
  const [error, setError] = useState<string | null>(null);

  async function submit(pin: string): Promise<boolean> {
    const result = await onCreate({ name, role, pin });
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    toast(`Added ${name.trim()}`, 'success');
    onClose();
    return true;
  }

  return (
    <Modal open onClose={onClose} title="Add person" width="sm">
      {step === 'details' ? (
        <div className="flex flex-col gap-4">
          <Field
            label="Name"
            placeholder="Ate Nena"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
          <div>
            <p className="mb-2 text-[11px] font-bold tracking-wide text-ink-2 uppercase">
              Role
            </p>
            <div className="flex flex-col gap-1.5">
              {ROLES.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setRole(option)}
                  aria-pressed={role === option}
                  className={cn(
                    'rounded-md border px-3 py-2 text-left transition-colors',
                    role === option
                      ? 'border-accent bg-accent/10'
                      : 'border-line bg-raised hover:bg-ground',
                  )}
                >
                  <span className="block text-[13px] font-semibold">
                    {ROLE_LABELS[option]}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-ink-3">
                    {ROLE_HINTS[option]}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <Button
            fullWidth
            size="lg"
            disabled={!name.trim()}
            onClick={() => setStep('pin')}
          >
            Set their PIN
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center">
          <p className="mb-5 max-w-[250px] text-center text-[12px] leading-relaxed text-ink-2">
            Six digits for <strong>{name.trim()}</strong>. They sign in with this and
            nothing else, so it cannot match anyone else&apos;s.
          </p>
          <PinPad onSubmit={submit} message={error ?? ' '} tone={error ? 'bad' : 'muted'} />
          <button
            type="button"
            onClick={() => {
              setStep('details');
              setError(null);
            }}
            className="mt-5 text-[12px] font-semibold text-ink-3 hover:text-accent"
          >
            Back
          </button>
        </div>
      )}
    </Modal>
  );
}

function SetPinModal({
  user,
  onClose,
  onSet,
}: {
  user: User;
  onClose: () => void;
  onSet: (pin: string) => Promise<Outcome>;
}) {
  const [error, setError] = useState<string | null>(null);

  async function submit(pin: string): Promise<boolean> {
    const result = await onSet(pin);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    toast(`New PIN set for ${user.name}`, 'success');
    onClose();
    return true;
  }

  return (
    <Modal open onClose={onClose} title={`New PIN — ${user.name}`} width="sm">
      <div className="flex flex-col items-center">
        <p className="mb-5 max-w-[250px] text-center text-[12px] leading-relaxed text-ink-2">
          The old PIN stops working the moment this is set. Nobody can read either one
          back out — only the hash is kept.
        </p>
        <PinPad onSubmit={submit} message={error ?? ' '} tone={error ? 'bad' : 'muted'} />
      </div>
    </Modal>
  );
}
