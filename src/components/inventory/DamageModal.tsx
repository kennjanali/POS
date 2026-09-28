'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { decimalsAllowed, formatQty, parseQty } from '@/lib/qty';
import type { Product } from '@/lib/types';
import { usePos } from '@/store/usePos';

/** Stock written off as damaged or spoiled, with the reason. */
export function DamageModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const settings = usePos((s) => s.settings);
  const onHand = usePos((s) => s.stockOf(product.id));
  const recordDamage = usePos((s) => s.recordDamage);
  const [input, setInput] = useState('');
  const [note, setNote] = useState('');

  function save() {
    const q = parseQty(input, decimalsAllowed(product.unit, settings.features));
    if (q === null) {
      toast('Enter how many were damaged', 'danger');
      return;
    }
    const result = recordDamage(product.id, q, note);
    if (!result.ok) {
      toast(result.error, 'danger');
      return;
    }
    toast(`Wrote off ${formatQty(q)} ${product.name}`, 'success');
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Damaged or lost: ${product.name}`}
      width="sm"
      footer={
        <Button fullWidth variant="danger" onClick={save} disabled={!input.trim() || !note.trim()}>
          Write off
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[12.5px] text-ink-2">
          {formatQty(onHand)} {product.unit} on hand.
        </p>
        <Field
          label="Quantity"
          inputMode="decimal"
          autoFocus
          suffix={product.unit}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <Field
          label="What happened"
          placeholder="e.g. dropped, expired"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Modal>
  );
}
