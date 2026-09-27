'use client';

import Link from 'next/link';
import { Check, Circle } from 'lucide-react';

import { toast } from '@/components/ui/Toast';
import { checklistItems, dismissed, type ChecklistId } from '@/lib/checklist';
import { usePos } from '@/store/usePos';

/**
 * Today's finish-setting-up card. It says what is left in the plainest terms
 * and then gets out of the way: once a job is done, or the owner says not now,
 * it stops being asked. It never blocks a sale, and only the owner sees it —
 * every answer lives behind Settings, which staff cannot open.
 */
export function SetupChecklist() {
  const settings = usePos((s) => s.settings);
  const licensed = usePos((s) => s.licensed);
  const users = usePos((s) => s.users);
  const updateSettings = usePos((s) => s.updateSettings);

  const all = checklistItems({ settings, licensed, users });
  const outstanding = all.filter((item) => !item.done).length;
  if (outstanding === 0) return null;

  const dismiss = (id: ChecklistId) => {
    const result = updateSettings({ checklistDismissed: dismissed(settings, id) });
    if (!result.ok) toast(result.error, 'danger');
  };

  return (
    <section className="rounded-lg border border-line bg-surface p-3.5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[11px] font-bold tracking-wide text-ink-2 uppercase">
          Finish setting up
        </h3>
        <span className="tnum text-[11px] text-ink-3">
          {all.length - outstanding} of {all.length} done
        </span>
      </div>
      <ul className="flex list-none flex-col gap-1 p-0">
        {all.map((item) => (
          <li key={item.id} className="flex items-center gap-2 text-[12.5px]">
            {item.done ? (
              <Check size={15} className="shrink-0 text-good" aria-hidden />
            ) : (
              <Circle size={15} className="shrink-0 text-ink-3" aria-hidden />
            )}
            {item.done ? (
              <span className="flex-1 text-ink-3 line-through">{item.label}</span>
            ) : (
              <>
                <Link
                  href={item.href}
                  className="min-h-8 flex-1 self-center font-semibold text-accent hover:underline"
                >
                  {item.label}
                </Link>
                <button
                  type="button"
                  onClick={() => dismiss(item.id)}
                  title="Not now — stop asking"
                  className="min-h-8 shrink-0 rounded-md px-2 text-[11px] font-semibold text-ink-3 hover:bg-raised hover:text-ink-2"
                >
                  Not now
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
