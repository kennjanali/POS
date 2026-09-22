'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';

import { peso } from '@/lib/format';
import { usePos } from '@/store/usePos';
import { cn } from '@/components/ui/cn';

interface MenuGridProps {
  orderId: string;
}

export function MenuGrid({ orderId }: MenuGridProps) {
  const products = usePos((s) => s.products);
  const stock = usePos((s) => s.stock);
  const branchId = usePos((s) => s.activeBranchId);
  const settings = usePos((s) => s.settings);
  const addLine = usePos((s) => s.addLine);

  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter(
      (p) => p.active && (q === '' || p.name.toLowerCase().includes(q)),
    );
  }, [products, query]);

  return (
    <div className="flex h-full flex-col gap-3 border-r border-line p-3">
      <div className="relative shrink-0">
        <Search
          size={14}
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search menu"
          aria-label="Search menu"
          className="h-9 w-full rounded-md border border-line bg-raised pr-3 pl-8 text-[13px] placeholder:text-ink-3 focus:border-accent"
        />
      </div>

      <div className="scroll-y grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-2 pr-1">
        {visible.map((product) => {
          const onHand = stock[branchId]?.[product.id] ?? 0;
          const out = onHand <= 0;
          const low = !out && onHand <= settings.lowStockAt;

          return (
            <button
              key={product.id}
              type="button"
              onClick={() => addLine(orderId, product.id)}
              className={cn(
                'flex min-h-[76px] flex-col justify-between gap-1 rounded-lg border p-2.5 text-left',
                'transition-[border-color,transform] active:scale-[0.98]',
                out
                  ? 'border-bad/40 bg-bad/5 hover:border-bad'
                  : 'border-line bg-surface hover:border-accent',
              )}
            >
              <span className="line-clamp-2 text-[12.5px] leading-snug font-semibold">
                {product.name}
              </span>
              <span className="flex items-end justify-between gap-1">
                <span className="tnum text-[13px] font-bold text-accent">
                  {peso(product.priceCents, settings.currency)}
                </span>
                {settings.showStock && (
                  <span
                    className={cn(
                      'tnum text-[10px] font-bold',
                      out ? 'text-bad' : low ? 'text-warn' : 'text-ink-3',
                    )}
                  >
                    {onHand}
                  </span>
                )}
              </span>
            </button>
          );
        })}

        {visible.length === 0 && (
          <p className="col-span-full py-8 text-center text-[13px] text-ink-3">
            No items match “{query}”.
          </p>
        )}
      </div>
    </div>
  );
}
