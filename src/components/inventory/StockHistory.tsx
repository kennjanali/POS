'use client';

import { useMemo } from 'react';

import { Modal } from '@/components/ui/Modal';
import { cn } from '@/components/ui/cn';
import { fmtDate, fmtTime } from '@/lib/format';
import { formatQty } from '@/lib/qty';
import { productHistory } from '@/lib/stockHistory';
import type { Product } from '@/lib/types';
import { usePos } from '@/store/usePos';

/** Every stock move for one item in this branch, newest first. */
export function StockHistory({ product, onClose }: { product: Product; onClose: () => void }) {
  const moves = usePos((s) => s.stockMoves);
  const orders = usePos((s) => s.orders);
  const users = usePos((s) => s.users);
  const branchId = usePos((s) => s.activeBranchId);

  const rows = useMemo(
    () => productHistory(moves, orders, users, product.id, branchId),
    [moves, orders, users, product.id, branchId],
  );

  return (
    <Modal open onClose={onClose} title={`History: ${product.name}`} width="lg">
      {rows.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-ink-3">No stock moves yet.</p>
      ) : (
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-left text-[10.5px] tracking-wide text-ink-3 uppercase">
              <th className="py-2 pr-3 font-bold">When</th>
              <th className="py-2 pr-3 font-bold">What</th>
              <th className="py-2 pr-3 text-right font-bold">Qty</th>
              <th className="py-2 pr-3 font-bold">Who</th>
              <th className="py-2 font-bold">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line/60">
                <td className="tnum py-2 pr-3 whitespace-nowrap text-ink-2">
                  {fmtDate(r.at)} {fmtTime(r.at)}
                </td>
                <td className="py-2 pr-3 font-semibold">{r.label}</td>
                <td
                  className={cn(
                    'tnum py-2 pr-3 text-right font-bold whitespace-nowrap',
                    r.delta < 0 ? 'text-bad' : 'text-good',
                  )}
                >
                  {r.delta > 0 ? '+' : ''}
                  {formatQty(r.delta)} {product.unit}
                </td>
                <td className="py-2 pr-3">{r.who}</td>
                <td className="py-2 text-ink-2">
                  {[
                    r.saleNo && `#${r.saleNo}`,
                    r.supplier,
                    r.docNo,
                    r.note,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
