'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { decimalsAllowed, formatQty, parseQty, type Qty } from '@/lib/qty';
import type { Product } from '@/lib/types';
import { usePos } from '@/store/usePos';

/** What is on the shelf. The difference from the record is logged as a count. */
export function CountModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const settings = usePos((s) => s.settings);
  const onHand = usePos((s) => s.stockOf(product.id));
  const countStock = usePos((s) => s.countStock);
  const [input, setInput] = useState('');
  const [note, setNote] = useState('');

  function save() {
    const typed = input.trim();
    // parseQty refuses zero; an empty shelf is a real count.
    const counted = /^0*(\.0*)?$/.test(typed)
      ? (0 as Qty)
      : parseQty(typed, decimalsAllowed(product.unit, settings.features));
    if (counted === null) {
      toast('Enter the number on the shelf, 0 or more', 'danger');
      return;
    }
    const result = countStock(product.id, counted, note);
    if (!result.ok) {
      toast(result.error, 'danger');
      return;
    }
    toast(`Counted ${product.name}: ${formatQty(counted)}`, 'success');
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Stock count: ${product.name}`}
      width="sm"
      footer={
        <Button fullWidth onClick={save} disabled={!input.trim()}>
          Save count
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[12.5px] text-ink-2">
          The record says {formatQty(onHand)} {product.unit}.
        </p>
        <Field
          label="Counted on the shelf"
          inputMode="decimal"
          autoFocus
          suffix={product.unit}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <Field
          label="Note"
          placeholder="Optional"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Modal>
  );
}
