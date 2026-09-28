'use client';

import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';

import { AddStockModal } from '@/components/inventory/AddStockModal';
import { CountModal } from '@/components/inventory/CountModal';
import { DamageModal } from '@/components/inventory/DamageModal';
import { ImportExport } from '@/components/inventory/ImportExport';
import { ProductForm } from '@/components/inventory/ProductForm';
import { PromoCodes } from '@/components/inventory/PromoCodes';
import { StockHistory } from '@/components/inventory/StockHistory';
import { Button } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import { Tip } from '@/components/ui/Tip';
import { peso } from '@/lib/format';
import { cents } from '@/lib/money';
import { sortProducts } from '@/lib/products';
import { formatQty, qty } from '@/lib/qty';
import type { Product, ProductKind } from '@/lib/types';
import { usePos } from '@/store/usePos';

type Tab = 'products' | 'services' | 'promos';

const TABS: [Tab, string][] = [
  ['products', 'Products'],
  ['services', 'Services'],
  ['promos', 'Promo codes'],
];

/** What is open over the list. */
type Dialog =
  | { kind: 'form'; product: Product | null; newKind: ProductKind }
  | { kind: 'stock'; productId: string | null }
  | { kind: 'count'; product: Product }
  | { kind: 'damage'; product: Product }
  | { kind: 'history'; product: Product };

export default function InventoryPage() {
  const products = usePos((s) => s.products);
  const stock = usePos((s) => s.stock);
  const orders = usePos((s) => s.orders);
  const branchId = usePos((s) => s.activeBranchId);
  const branches = usePos((s) => s.branches);
  const setActiveBranch = usePos((s) => s.setActiveBranch);
  const settings = usePos((s) => s.settings);
  const lowStock = usePos((s) => s.lowStock);

  const [tab, setTab] = useState<Tab>('products');
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const rows = useMemo(
    () =>
      sortProducts(products)
        .filter((p) => p.active)
        .map((p) => ({
          product: p,
          onHand: stock[branchId]?.[p.id] ?? qty(0),
          level: p.reorderLevel ?? settings.lowStockAt,
        })),
    [products, stock, branchId, settings.lowStockAt],
  );
  const stocked = rows.filter((r) => r.product.kind === 'stock');
  const services = rows.filter((r) => r.product.kind === 'service');

  // lowStock() reads the store; these are what it reads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const low = useMemo(() => lowStock(), [lowStock, products, stock, orders, branchId, settings]);
  const nameOf = (id: string) => products.find((p) => p.id === id)?.name ?? id;

  const openBranches = branches.filter((b) => b.active);
  const shown = tab === 'products' ? stocked.length : tab === 'services' ? services.length : 0;

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-3 empty:hidden">
        <Tip id="inventory">Add stock here when a delivery arrives.</Tip>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2">
        <div className="flex gap-1" role="tablist">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                'min-h-10 rounded-md px-3 text-[12.5px] font-semibold transition-colors',
                tab === id ? 'bg-accent/10 text-accent' : 'text-ink-2 hover:bg-raised',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {tab !== 'promos' && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold tracking-wide text-ink-3 uppercase">
              {shown} {tab === 'products' ? 'item' : 'service'}
              {shown === 1 ? '' : 's'}
            </span>
            {tab === 'products' && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setDialog({ kind: 'stock', productId: null })}
              >
                Add stock
              </Button>
            )}
            <ImportExport />
            <Button
              size="sm"
              onClick={() =>
                setDialog({
                  kind: 'form',
                  product: null,
                  newKind: tab === 'services' ? 'service' : 'stock',
                })
              }
            >
              <Plus size={14} aria-hidden />
              {tab === 'services' ? 'Add service' : 'Add item'}
            </Button>
          </div>
        )}
      </div>

      {/* Stock is per branch, so the tab switches the whole till rather than
          just this view — an adjustment always lands on the branch on screen. */}
      {tab === 'products' && openBranches.length > 1 && (
        <div className="flex gap-1 overflow-x-auto border-b border-line bg-surface px-4 py-1.5">
          {openBranches.map((branch) => (
            <button
              key={branch.id}
              type="button"
              aria-pressed={branch.id === branchId}
              onClick={() => setActiveBranch(branch.id)}
              className={cn(
                'flex min-h-10 shrink-0 items-center gap-1.5 rounded-md border px-3 py-1 text-[12px] font-semibold transition-colors',
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
        {tab === 'products' && (
          <>
            {low.length > 0 && (
              <div className="mb-3 rounded-md border border-warn/40 bg-warn/5 p-3 text-[12px]">
                <p className="mb-1.5 font-bold text-warn">Low stock</p>
                <ul className="flex flex-col gap-1">
                  {low.map((r) => (
                    <li key={r.productId} className="flex items-center justify-between gap-2">
                      <span>
                        <span className="font-semibold">{nameOf(r.productId)}</span>
                        <span className="tnum ml-1.5 text-ink-2">
                          {r.available > 0
                            ? `${formatQty(r.available)} left (reorder at ${formatQty(r.level)})`
                            : 'Out of stock'}
                        </span>
                      </span>
                      <ActionButton
                        onClick={() => setDialog({ kind: 'stock', productId: r.productId })}
                      >
                        Add stock
                      </ActionButton>
                    </li>
                  ))}
                </ul>
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
                  <th className="py-2 font-bold">Stock</th>
                </tr>
              </thead>
              <tbody>
                {stocked.map(({ product, onHand, level }) => {
                  const margin = product.priceCents - product.costCents;
                  return (
                    <EditableRow
                      key={product.id}
                      onEdit={() => setDialog({ kind: 'form', product, newKind: 'stock' })}
                    >
                      <td className="py-2 pr-3">
                        <span className="font-semibold">{product.name}</span>
                        <span className="ml-1.5 text-[11px] text-ink-3">
                          /{product.unit}
                          {[product.category, product.sku]
                            .filter(Boolean)
                            .map((tag) => ` · ${tag}`)
                            .join('')}
                        </span>
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
                          onHand <= level && 'text-warn',
                        )}
                      >
                        {formatQty(onHand)}
                      </td>
                      <td className="py-2">
                        <div
                          className="flex gap-1"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <ActionButton
                            onClick={() => setDialog({ kind: 'stock', productId: product.id })}
                          >
                            Add stock
                          </ActionButton>
                          <ActionButton onClick={() => setDialog({ kind: 'count', product })}>
                            Count
                          </ActionButton>
                          <ActionButton onClick={() => setDialog({ kind: 'damage', product })}>
                            Damage
                          </ActionButton>
                          <ActionButton onClick={() => setDialog({ kind: 'history', product })}>
                            History
                          </ActionButton>
                        </div>
                      </td>
                    </EditableRow>
                  );
                })}
              </tbody>
            </table>
          </>
        )}

        {tab === 'services' && (
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left text-[10.5px] tracking-wide text-ink-3 uppercase">
                <th className="py-2 pr-3 font-bold">Name</th>
                <th className="py-2 pr-3 font-bold">Category</th>
                <th className="py-2 pr-3 font-bold">Unit</th>
                <th className="py-2 text-right font-bold">Price</th>
              </tr>
            </thead>
            <tbody>
              {services.map(({ product }) => (
                <EditableRow
                  key={product.id}
                  onEdit={() => setDialog({ kind: 'form', product, newKind: 'service' })}
                >
                  <td className="py-2 pr-3 font-semibold">{product.name}</td>
                  <td className="py-2 pr-3 text-ink-2">{product.category || '—'}</td>
                  <td className="py-2 pr-3 text-ink-2">{product.unit}</td>
                  <td className="tnum py-2 text-right">
                    {peso(product.priceCents, settings.currency)}
                  </td>
                </EditableRow>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'promos' && <PromoCodes />}
      </div>

      {dialog?.kind === 'form' && (
        <ProductForm
          product={dialog.product}
          kind={dialog.newKind}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'stock' && (
        <AddStockModal productId={dialog.productId} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'count' && (
        <CountModal product={dialog.product} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'damage' && (
        <DamageModal product={dialog.product} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'history' && (
        <StockHistory product={dialog.product} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

/** A table row that opens the item for editing. */
function EditableRow({ onEdit, children }: { onEdit: () => void; children: React.ReactNode }) {
  return (
    <tr
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onEdit();
        }
      }}
      className="cursor-pointer border-b border-line/60 hover:bg-raised focus-visible:bg-raised focus-visible:outline-none"
    >
      {children}
    </tr>
  );
}

function ActionButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-10 rounded border border-line bg-raised px-2.5 text-[12px] font-semibold hover:border-accent"
    >
      {children}
    </button>
  );
}
