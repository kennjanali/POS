import type { LucideIcon } from 'lucide-react';

interface EmptyProps {
  icon: LucideIcon;
  title: string;
  /** An empty screen is an invitation to act — say what to do next. */
  action?: string;
}

export function Empty({ icon: Icon, title, action }: EmptyProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <Icon size={26} className="text-ink-4" aria-hidden />
      <p className="text-[13px] font-semibold text-ink-2">{title}</p>
      {action && <p className="max-w-xs text-[12px] text-ink-3">{action}</p>}
    </div>
  );
}
