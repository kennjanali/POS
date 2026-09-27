'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { parsePesos } from '@/lib/money';
import { decimalsAllowed, parseQty, type Qty } from '@/lib/qty';
import { UNITS, type ProductKind } from '@/lib/types';
import { usePos } from '@/store/usePos';
import { KIND_LABELS, Select } from './ProductForm';

/** Add an item to Inventory from the sell screen, without leaving the sale. */
export function QuickAdd({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (productId: string) => void;
}) {
  const settings = usePos((s) => s.settings);
  const quickAddProduct = usePos((s) => s.quickAddProduct);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [kind, setKind] = useState<ProductKind>('stock');
  const [unit, setUnit] = useState('pcs');
  const [opening, setOpening] = useState('');

  function save() {
    const typed = opening.trim();
    const openingQty =
      kind === 'service' || typed === ''
        ? (0 as Qty)
        : parseQty(typed, decimalsAllowed(unit, settings.features));
    if (openingQty === null) {
      toast('Enter how many are on hand, or leave it blank', 'danger');
      return;
    }
    const result = quickAddProduct({ name, priceCents: parsePesos(price), kind, unit, openingQty });
    if (!result.ok) {
      toast(result.error, 'danger');
      return;
    }
    toast(`Added ${name.trim()} to Inventory`, 'success');
    onAdded(result.id);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add item"
      width="sm"
      footer={
        <Button fullWidth onClick={save} disabled={!name.trim() || !price.trim()}>
          Add and sell
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        <Field
          label="Price"
          inputMode="decimal"
          suffix={settings.currency}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        {settings.features.services && (
          <Select
            label="Kind"
            value={kind}
            options={Object.entries(KIND_LABELS)}
            onChange={(k) => setKind(k as ProductKind)}
          />
        )}
        <Select
          label="Unit"
          value={unit}
          options={UNITS.map((u) => [u, u])}
          onChange={setUnit}
        />
        {kind === 'stock' && (
          <Field
            label="On hand now"
            inputMode="decimal"
            placeholder="0"
            suffix={unit}
            value={opening}
            onChange={(e) => setOpening(e.target.value)}
          />
        )}
      </div>
    </Modal>
  );
}
