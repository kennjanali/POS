'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { parsePesos, type Centavos } from '@/lib/money';
import { sortProducts } from '@/lib/products';
import { decimalsAllowed, parseQty, type Qty } from '@/lib/qty';
import { usePos } from '@/store/usePos';
import { Select } from './ProductForm';

interface Line {
  productId: string;
  qty: string;
  /** Blank keeps the item's current cost. */
  cost: string;
}

/** A delivery: one or more items, how many of each, and optionally the new cost. */
export function AddStockModal({
  productId,
  onClose,
}: {
  productId: string | null;
  onClose: () => void;
}) {
  const products = usePos((s) => s.products);
  const settings = usePos((s) => s.settings);
  const receiveStock = usePos((s) => s.receiveStock);

  const stocked = sortProducts(products).filter((p) => p.active && p.kind === 'stock');
  const [lines, setLines] = useState<Line[]>(
    productId ? [{ productId, qty: '', cost: '' }] : [],
  );
  const [supplier, setSupplier] = useState('');
  const [docNo, setDocNo] = useState('');

  const unpicked = stocked.filter((p) => !lines.some((l) => l.productId === p.id));

  function update(index: number, patch: Partial<Line>) {
    setLines(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function save() {
    const parsed: { productId: string; qty: Qty; unitCostCents?: Centavos }[] = [];
    for (const line of lines) {
      const product = products.find((p) => p.id === line.productId);
      if (!product) continue;
      const q = parseQty(line.qty, decimalsAllowed(product.unit, settings.features));
      if (q === null) {
        toast(`Enter how many ${product.name} came in`, 'danger');
        return;
      }
      const cost = line.cost.trim();
      parsed.push(cost === '' ? { productId: product.id, qty: q } : { productId: product.id, qty: q, unitCostCents: parsePesos(cost) });
    }
    const result = receiveStock({ lines: parsed, supplier, docNo });
    if (!result.ok) {
      toast(result.error, 'danger');
      return;
    }
    toast('Stock added', 'success');
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add stock"
      footer={
        <Button fullWidth onClick={save} disabled={lines.length === 0}>
          Add stock
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {lines.map((line, index) => {
          const product = products.find((p) => p.id === line.productId);
          if (!product) return null;
          return (
            <div key={line.productId} className="rounded-md border border-line p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[13px] font-semibold">{product.name}</p>
                <button
                  type="button"
                  aria-label={`Remove ${product.name}`}
                  onClick={() => setLines(lines.filter((_, i) => i !== index))}
                  className="grid size-10 place-items-center rounded text-ink-3 hover:bg-raised hover:text-ink"
                >
                  <X size={14} aria-hidden />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Quantity"
                  inputMode="decimal"
                  suffix={product.unit}
                  value={line.qty}
                  onChange={(e) => update(index, { qty: e.target.value })}
                />
                <Field
                  label="Unit cost"
                  inputMode="decimal"
                  placeholder={(product.costCents / 100).toFixed(2)}
                  hint="Blank keeps the current cost"
                  suffix={settings.currency}
                  value={line.cost}
                  onChange={(e) => update(index, { cost: e.target.value })}
                />
              </div>
            </div>
          );
        })}

        {unpicked.length > 0 && (
          <Select
            label={lines.length === 0 ? 'Item' : 'Add another item'}
            value=""
            options={[['', 'Choose an item…'], ...unpicked.map((p): [string, string] => [p.id, p.name])]}
            onChange={(id) => id && setLines([...lines, { productId: id, qty: '', cost: '' }])}
          />
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Supplier"
            placeholder="Optional"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
          />
          <Field
            label="Delivery or invoice no."
            placeholder="Optional"
            value={docNo}
            onChange={(e) => setDocNo(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}
