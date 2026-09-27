'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/components/ui/cn';
import { businessDate } from '@/lib/format';
import { promoStatus, type PromoStatus } from '@/lib/promo';
import type { Promo } from '@/lib/types';
import { usePos, type PromoInput, type UserResult } from '@/store/usePos';

/** In the cashier's words, not the spec's. */
const STATUS_LABEL: Record<PromoStatus, string> = {
  active: 'Active',
  scheduled: 'Starts later',
  expired: 'Finished',
  off: 'Off',
};

const STATUS_STYLE: Record<PromoStatus, string> = {
  active: 'bg-good/10 text-good',
  scheduled: 'bg-note/10 text-note',
  expired: 'bg-raised text-ink-3',
  off: 'bg-raised text-ink-3',
};

export function PromoCodes() {
  const promos = usePos((s) => s.promos);
  const createPromo = usePos((s) => s.createPromo);
  const updatePromo = usePos((s) => s.updatePromo);
  const setPromoActive = usePos((s) => s.setPromoActive);
  const promoUses = usePos((s) => s.promoUses);
  const [editing, setEditing] = useState<Promo | null | 'new'>(null);

  const today = businessDate(Date.now());
  const ordered = [...promos].sort((a, b) => a.code.localeCompare(b.code));

  function run(result: UserResult) {
    if (!result.ok) toast(result.error, 'danger');
    return result;
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12px] text-ink-2">
            Codes the owner makes here. Anyone can type one in at payment.
          </p>
          <Button onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" />
            Add code
          </Button>
        </div>

        {ordered.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-ink-3">
            No promo codes yet.
          </p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[10.5px] font-bold tracking-wide text-ink-2 uppercase">
                <th className="py-2">Code</th>
                <th className="py-2">Off</th>
                <th className="py-2">Status</th>
                <th className="py-2">Sales used</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {ordered.map((p) => {
                const status = promoStatus(p, today);
                // Once a sale has closed with a code its percent and text are
                // frozen: the owner turns it off and makes another.
                const locked = p.firstUsedAt !== null;
                return (
                  <tr key={p.id} className="border-b border-line/60">
                    <td className="py-2.5 font-semibold text-ink">{p.code}</td>
                    <td className="py-2.5 text-ink-2">{p.percent}%</td>
                    <td className="py-2.5">
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[11px] font-semibold',
                          STATUS_STYLE[status],
                        )}
                      >
                        {STATUS_LABEL[status]}
                      </span>
                    </td>
                    <td className="py-2.5 text-ink-2">{promoUses(p.id)}</td>
                    <td className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setEditing(p)}
                          disabled={locked}
                          title={locked ? 'Used on a sale. Turn it off and make a new one.' : undefined}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant={p.active ? 'secondary' : 'primary'}
                          onClick={() => run(setPromoActive(p.id, !p.active))}
                        >
                          {p.active ? 'Turn off' : 'Turn on'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

      </div>

      {editing && (
        <PromoForm
          promo={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(input) => {
            const result = editing === 'new' ? createPromo(input) : updatePromo(editing.id, input);
            if (!run(result).ok) return false;
            setEditing(null);
            return true;
          }}
        />
      )}
    </>
  );
}

function PromoForm({
  promo,
  onClose,
  onSave,
}: {
  promo: Promo | null;
  onClose: () => void;
  onSave: (input: PromoInput) => boolean;
}) {
  const [code, setCode] = useState(promo?.code ?? '');
  const [percent, setPercent] = useState(promo ? String(promo.percent) : '');
  const [note, setNote] = useState(promo?.note ?? '');
  const [startsOn, setStartsOn] = useState(promo?.startsOn ?? '');
  const [endsOn, setEndsOn] = useState(promo?.endsOn ?? '');
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal
      open
      onClose={onClose}
      title={promo ? `Change ${promo.code}` : 'Add a promo code'}
      width="md"
      footer={
        <div className="flex gap-2">
          <Button
            onClick={() => {
              const ok = onSave({
                code,
                percent: Number(percent),
                note,
                startsOn: startsOn || null,
                endsOn: endsOn || null,
              });
              if (!ok) setError('That code could not be saved. Check the code and the percent.');
            }}
          >
            Save code
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <Field
          label="Code"
          placeholder="GRAND10"
          autoCapitalize="characters"
          autoComplete="off"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          hint="3 to 12 letters or digits. Typed with spaces or lower case, it still works."
          error={error ?? undefined}
        />
        <Field
          label="Percent off"
          type="number"
          min={1}
          max={100}
          suffix="%"
          placeholder="10"
          value={percent}
          onChange={(e) => setPercent(e.target.value)}
        />
        <Field
          label="Note (optional)"
          placeholder="Grand opening"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Starts on (optional)"
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
          />
          <Field
            label="Ends on (optional)"
            type="date"
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
            hint="The last day it works, inclusive."
          />
        </div>
      </div>
    </Modal>
  );
}
