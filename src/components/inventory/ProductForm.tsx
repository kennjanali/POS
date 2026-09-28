'use client';

import { useId, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { uuidv7 } from '@/lib/id';
import { parsePesos } from '@/lib/money';
import { decimalsAllowed, formatQty, parseQty } from '@/lib/qty';
import { UNITS, type Product, type ProductKind } from '@/lib/types';
import { usePos } from '@/store/usePos';

interface Draft {
  name: string;
  kind: ProductKind;
  sku: string;
  category: string;
  unit: string;
  price: string;
  cost: string;
  /** Blank means the shop default. */
  reorderLevel: string;
}

export const KIND_LABELS: Record<ProductKind, string> = { stock: 'Product', service: 'Service' };

function draftOf(product: Product | null, kind: ProductKind): Draft {
  if (!product) {
    return {
      name: '',
      kind,
      sku: '',
      category: '',
      unit: kind === 'service' ? 'job' : 'pcs',
      price: '',
      cost: '',
      reorderLevel: '',
    };
  }
  return {
    name: product.name,
    kind: product.kind,
    sku: product.sku ?? '',
    category: product.category,
    unit: product.unit,
    price: (product.priceCents / 100).toFixed(2),
    cost: (product.costCents / 100).toFixed(2),
    reorderLevel: product.reorderLevel === null ? '' : formatQty(product.reorderLevel),
  };
}

/** Add or edit an item. `kind` is what a new item starts as. */
export function ProductForm({
  product,
  kind,
  onClose,
}: {
  product: Product | null;
  kind: ProductKind;
  onClose: () => void;
}) {
  const settings = usePos((s) => s.settings);
  const upsertProduct = usePos((s) => s.upsertProduct);
  const [draft, setDraft] = useState(() => draftOf(product, kind));

  function save() {
    const name = draft.name.trim();
    if (!name) return;

    // A negative price turns a menu item into a discount anyone can stack onto
    // a bill until it reaches zero. The order then closes with no tender and
    // reads as a normal completed sale rather than a void, so nothing in the
    // day's review points at it.
    const priceCents = parsePesos(draft.price);
    const costCents = parsePesos(draft.cost);
    if (priceCents < 0 || costCents < 0) {
      toast('Price and cost cannot be negative', 'danger');
      return;
    }

    // Services are never stocked, so they have no reorder level.
    const levelInput = draft.kind === 'stock' ? draft.reorderLevel.trim() : '';
    const reorderLevel =
      levelInput === '' ? null : parseQty(levelInput, decimalsAllowed(draft.unit, settings.features));
    if (levelInput !== '' && reorderLevel === null) {
      toast('Enter a reorder level above 0, or leave it blank for the shop default', 'danger');
      return;
    }

    const result = upsertProduct({
      id: product?.id ?? uuidv7(),
      name,
      kind: draft.kind,
      sku: draft.sku.trim() || null,
      category: draft.category.trim(),
      unit: draft.unit,
      priceCents,
      costCents,
      vatExempt: false,
      active: true,
      reorderLevel,
    });
    if (!result.ok) {
      toast(result.error, 'danger');
      return;
    }
    onClose();
    toast(`Saved ${name}`, 'success');
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={product ? 'Edit item' : draft.kind === 'service' ? 'Add service' : 'Add item'}
      width="sm"
      footer={
        <Button fullWidth onClick={save} disabled={!draft.name.trim()}>
          Save item
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field
          label="Name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <Select
          label="Kind"
          value={draft.kind}
          options={Object.entries(KIND_LABELS)}
          onChange={(kind) => setDraft({ ...draft, kind: kind as ProductKind })}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="SKU"
            placeholder="Optional"
            value={draft.sku}
            onChange={(e) => setDraft({ ...draft, sku: e.target.value })}
          />
          <Field
            label="Category"
            placeholder="Optional"
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
          />
        </div>
        <Select
          label="Unit"
          value={draft.unit}
          // An item from before v8 may use a unit outside the list; it stays offered.
          options={[...new Set<string>([...UNITS, draft.unit])].map((u) => [u, u])}
          onChange={(unit) => setDraft({ ...draft, unit })}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Price"
            inputMode="decimal"
            suffix={settings.currency}
            value={draft.price}
            onChange={(e) => setDraft({ ...draft, price: e.target.value })}
          />
          <Field
            label="Cost"
            inputMode="decimal"
            suffix={settings.currency}
            value={draft.cost}
            onChange={(e) => setDraft({ ...draft, cost: e.target.value })}
          />
        </div>
        {draft.kind === 'stock' && (
          <Field
            label="Reorder level"
            inputMode="decimal"
            placeholder={`Shop default (${formatQty(settings.lowStockAt)})`}
            suffix={draft.unit}
            value={draft.reorderLevel}
            onChange={(e) => setDraft({ ...draft, reorderLevel: e.target.value })}
          />
        )}
      </div>
    </Modal>
  );
}

export function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [value: string, label: string][];
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[11px] font-bold tracking-wide text-ink-2 uppercase">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-md border border-line bg-raised px-3 text-[13px] text-ink focus:border-accent"
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}
