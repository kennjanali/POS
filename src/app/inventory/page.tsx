'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Plus } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/components/ui/cn';
import { uuidv7 } from '@/lib/id';
import { peso } from '@/lib/format';
import { cents, parsePesos } from '@/lib/money';
import type { Product } from '@/lib/types';
import { usePos } from '@/store/usePos';

interface Draft {
  id: string | null;
  name: string;
  unit: string;
  price: string;
  cost: string;
}

const EMPTY: Draft = { id: null, name: '', unit: 'pc', price: '', cost: '' };

export default function InventoryPage() {
  const products = usePos((s) => s.products);
  const stock = usePos((s) => s.stock);
  const branchId = usePos((s) => s.activeBranchId);
  const branches = usePos((s) => s.branches);
  const setActiveBranch = usePos((s) => s.setActiveBranch);
  const settings = usePos((s) => s.settings);
  const adjustStock = usePos((s) => s.adjustStock);
  const upsertProduct = usePos((s) => s.upsertProduct);

  const [draft, setDraft] = useState<Draft | null>(null);

  const rows = useMemo(
    () =>
      products
        .filter((p) => p.active)
        .map((p) => ({ product: p, onHand: stock[branchId]?.[p.id] ?? 0 })),
    [products, stock, branchId],
  );

  const openBranches = branches.filter((b) => b.active);
  const negative = rows.filter((r) => r.onHand < 0);
  const low = rows.filter((r) => r.onHand >= 0 && r.onHand <= settings.lowStockAt);

  function edit(product: Product) {
    setDraft({
      id: product.id,
      name: product.name,
      unit: product.unit,
      price: (product.priceCents / 100).toFixed(2),
      cost: (product.costCents / 100).toFixed(2),
    });
  }

  function save() {
    if (!draft) return;
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

    const product: Product = {
      id: draft.id ?? uuidv7(),
      name,
      unit: draft.unit.trim() || 'pc',
      priceCents,
      costCents,
      vatExempt: false,
      active: true,
    };
    upsertProduct(product);
    if (!draft.id) adjustStock(product.id, 0, 'opening', 'New item');
    setDraft(null);
    toast(`Saved ${name}`, 'success');
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2.5">
        <h2 className="text-[11px] font-bold tracking-wide text-ink-2 uppercase">
          {rows.length} items
        </h2>
        <Button size="sm" onClick={() => setDraft(EMPTY)}>
          <Plus size={14} aria-hidden />
          Add item
        </Button>
      </div>

      {/* Stock is per branch, so the tab switches the whole till rather than
          just this view — an adjustment always lands on the branch on screen. */}
      {openBranches.length > 1 && (
        <div className="flex gap-1 overflow-x-auto border-b border-line bg-surface px-4 py-1.5">
          {openBranches.map((branch) => (
            <button
              key={branch.id}
              type="button"
              aria-pressed={branch.id === branchId}
              onClick={() => setActiveBranch(branch.id)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] font-semibold transition-colors',
                branch.id === branchId
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-line bg-raised text-ink-2 hover:bg-ground',
              )}
            >
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ background: branch.color }}
              />
              {branch.name}
            </button>
          ))}
        </div>
      )}

      <div className="scroll-y flex-1 p-4">
        {/* Negative stock is a data-integrity problem, not a stock problem.
            v6 clamped it to zero and lost the discrepancy silently. */}
        {negative.length > 0 && (
          <div className="mb-3 flex gap-2 rounded-md border border-bad/40 bg-bad/5 p-3">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-bad" aria-hidden />
            <div className="min-w-0 text-[12px] leading-relaxed">
              <p className="font-bold text-bad">
                {negative.length} item{negative.length > 1 ? 's' : ''} sold below recorded
                stock
              </p>
              <p className="text-ink-2">
                {negative.map((r) => `${r.product.name} (${r.onHand})`).join(', ')}. Count
                the shelf and record the correction so the variance is traceable.
              </p>
            </div>
          </div>
        )}

        {low.length > 0 && (
          <div className="mb-3 rounded-md border border-warn/40 bg-warn/5 p-3 text-[12px]">
            <p className="font-bold text-warn">Running low</p>
            <p className="text-ink-2">
              {low.map((r) => `${r.product.name} (${r.onHand})`).join(', ')}
            </p>
          </div>
        )}

        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-left text-[10.5px] tracking-wide text-ink-3 uppercase">
              <th className="py-2 pr-3 font-bold">Item</th>
              <th className="py-2 pr-3 text-right font-bold">Price</th>
              <th className="py-2 pr-3 text-right font-bold">Cost</th>
              <th className="py-2 pr-3 text-right font-bold">Margin</th>
              <th className="py-2 pr-3 text-right font-bold">On hand</th>
              <th className="py-2 font-bold">Adjust</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ product, onHand }) => {
              const margin = product.priceCents - product.costCents;
              return (
                <tr
                  key={product.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => edit(product)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      edit(product);
                    }
                  }}
                  className="cursor-pointer border-b border-line/60 hover:bg-raised focus-visible:bg-raised focus-visible:outline-none"
                >
                  <td className="py-2 pr-3">
                    <span className="font-semibold">{product.name}</span>
                    <span className="ml-1.5 text-[11px] text-ink-3">/{product.unit}</span>
                  </td>
                  <td className="tnum py-2 pr-3 text-right">
                    {peso(product.priceCents, settings.currency)}
                  </td>
                  <td className="tnum py-2 pr-3 text-right text-ink-2">
                    {peso(product.costCents, settings.currency)}
                  </td>
                  <td
                    className={cn(
                      'tnum py-2 pr-3 text-right font-semibold',
                      margin <= 0 ? 'text-bad' : 'text-good',
                    )}
                  >
                    {peso(cents(margin), settings.currency)}
                  </td>
                  <td
                    className={cn(
                      'tnum py-2 pr-3 text-right font-bold',
                      onHand < 0
                        ? 'text-bad'
                        : onHand <= settings.lowStockAt
                          ? 'text-warn'
                          : '',
                    )}
                  >
                    {onHand}
                  </td>
                  <td className="py-2">
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      {[-1, +1, +10].map((delta) => (
                        <button
                          key={delta}
                          type="button"
                          onClick={() =>
                            adjustStock(
                              product.id,
                              delta,
                              delta > 0 ? 'restock' : 'count',
                            )
                          }
                          className="rounded border border-line bg-raised px-1.5 py-0.5 text-[11px] font-bold hover:border-accent"
                        >
                          {delta > 0 ? `+${delta}` : delta}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Edit item' : 'Add item'}
        width="sm"
        footer={
          <Button fullWidth onClick={save} disabled={!draft?.name.trim()}>
            Save item
          </Button>
        }
      >
        {draft && (
          <div className="flex flex-col gap-3">
            <Field
              label="Name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <Field
              label="Unit"
              placeholder="pc, cup, stick"
              value={draft.unit}
              onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
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
          </div>
        )}
      </Modal>
    </div>
  );
}
