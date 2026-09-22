'use client';

import { useState } from 'react';
import { Check, Pencil, Plus } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/components/ui/cn';
import { BRANCH_COLORS } from '@/lib/seed';
import type { Branch } from '@/lib/types';
import { usePos } from '@/store/usePos';

interface Draft {
  id: string | null;
  name: string;
  address: string;
  branchCode: string;
  color: string;
}

/** Next free BRnnn, so branch ids stay readable instead of becoming UUIDs. */
function nextBranchId(branches: Branch[]): string {
  const used = new Set(branches.map((b) => b.id));
  for (let n = 1; n < 1000; n++) {
    const id = `BR${String(n).padStart(3, '0')}`;
    if (!used.has(id)) return id;
  }
  return `BR${Date.now()}`;
}

/** Next free BIR branch code. Head office is 00000, branches count up. */
function nextBranchCode(branches: Branch[]): string {
  const used = new Set(branches.map((b) => b.branchCode));
  for (let n = 0; n < 100000; n++) {
    const code = String(n).padStart(5, '0');
    if (!used.has(code)) return code;
  }
  return '00000';
}

export function BranchManager() {
  const branches = usePos((s) => s.branches);
  const orders = usePos((s) => s.orders);
  const activeBranchId = usePos((s) => s.activeBranchId);
  const setActiveBranch = usePos((s) => s.setActiveBranch);
  const upsertBranch = usePos((s) => s.upsertBranch);

  const [draft, setDraft] = useState<Draft | null>(null);

  function startAdd() {
    setDraft({
      id: null,
      name: '',
      address: '',
      branchCode: nextBranchCode(branches),
      color: BRANCH_COLORS[branches.length % BRANCH_COLORS.length]!,
    });
  }

  function save() {
    if (!draft) return;
    const name = draft.name.trim();
    const branchCode = draft.branchCode.trim();
    if (!name || !branchCode) return;

    const others = branches.filter((b) => b.id !== draft.id);
    if (others.some((b) => b.name.toLowerCase() === name.toLowerCase())) {
      toast(`There is already a branch called ${name}`, 'danger');
      return;
    }
    // Invoice numbers are prefixed with the branch code. Two branches sharing
    // one code would issue colliding invoice numbers, which is the one thing
    // the per-branch sequence exists to prevent.
    if (others.some((b) => b.branchCode === branchCode)) {
      toast(`Branch code ${branchCode} is already used`, 'danger');
      return;
    }

    const existing = branches.find((b) => b.id === draft.id);
    upsertBranch({
      id: draft.id ?? nextBranchId(branches),
      name,
      address: draft.address.trim(),
      branchCode,
      color: draft.color,
      active: existing?.active ?? true,
    });
    setDraft(null);
    toast(existing ? `Saved ${name}` : `Opened ${name}`, 'success');
  }

  function setActive(branch: Branch, next: boolean) {
    if (next) {
      upsertBranch({ ...branch, active: true });
      toast(`${branch.name} reopened`, 'success');
      return;
    }

    const openHere = orders.filter(
      (o) => o.branchId === branch.id && o.status === 'open',
    ).length;
    if (openHere > 0) {
      toast(`${branch.name} still has ${openHere} open order(s)`, 'danger');
      return;
    }

    const remaining = branches.filter((b) => b.active && b.id !== branch.id);
    if (remaining.length === 0) {
      toast('At least one branch has to stay open', 'danger');
      return;
    }
    // Never leave the till pointed at a closed branch.
    if (activeBranchId === branch.id) setActiveBranch(remaining[0]!.id);
    upsertBranch({ ...branch, active: false });
    toast(`${branch.name} closed`, 'success');
  }

  return (
    <>
      <p className="text-[12px] leading-relaxed text-ink-2">
        Each branch keeps its own stock and its own gapless invoice sequence, prefixed
        with its BIR branch code. Closing a branch hides it from the till without
        touching its sales history.
      </p>

      <ul className="flex list-none flex-col gap-1.5 p-0">
        {branches.map((branch) => {
          const isCurrent = branch.id === activeBranchId;
          return (
            <li
              key={branch.id}
              className={cn(
                'flex flex-wrap items-center gap-2 rounded-md border bg-raised px-2.5 py-2',
                branch.active ? 'border-line' : 'border-line/60 opacity-60',
              )}
            >
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: branch.color }}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-1.5">
                  <span className="truncate text-[13px] font-bold">{branch.name}</span>
                  <span className="tnum shrink-0 text-[11px] text-ink-3">
                    {branch.branchCode}
                  </span>
                  {isCurrent && (
                    <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[9.5px] font-bold tracking-wide text-accent uppercase">
                      On till
                    </span>
                  )}
                  {!branch.active && (
                    <span className="shrink-0 text-[9.5px] font-bold tracking-wide text-ink-3 uppercase">
                      Closed
                    </span>
                  )}
                </span>
                {branch.address && (
                  <span className="mt-0.5 block truncate text-[11px] text-ink-3">
                    {branch.address}
                  </span>
                )}
              </span>

              <span className="flex shrink-0 gap-1">
                {branch.active && !isCurrent && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setActiveBranch(branch.id)}
                  >
                    <Check size={13} aria-hidden />
                    Use
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setDraft({
                      id: branch.id,
                      name: branch.name,
                      address: branch.address,
                      branchCode: branch.branchCode,
                      color: branch.color,
                    })
                  }
                >
                  <Pencil size={13} aria-hidden />
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setActive(branch, !branch.active)}
                >
                  {branch.active ? 'Close' : 'Reopen'}
                </Button>
              </span>
            </li>
          );
        })}
      </ul>

      <Button variant="secondary" fullWidth onClick={startAdd}>
        <Plus size={14} aria-hidden />
        Add branch
      </Button>

      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Edit branch' : 'Add branch'}
        width="sm"
        footer={
          <Button
            fullWidth
            onClick={save}
            disabled={!draft?.name.trim() || !draft?.branchCode.trim()}
          >
            Save branch
          </Button>
        }
      >
        {draft && (
          <div className="flex flex-col gap-3">
            <Field
              label="Name"
              placeholder="Mall Branch"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <Field
              label="Address"
              value={draft.address}
              onChange={(e) => setDraft({ ...draft, address: e.target.value })}
            />
            <Field
              label="BIR branch code"
              hint="Prefixes every invoice number from this branch. 00000 is head office."
              value={draft.branchCode}
              onChange={(e) => setDraft({ ...draft, branchCode: e.target.value })}
            />
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-bold tracking-wide text-ink-2 uppercase">
                Colour
              </span>
              <div className="flex flex-wrap gap-1.5">
                {BRANCH_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={color}
                    aria-pressed={draft.color === color}
                    onClick={() => setDraft({ ...draft, color })}
                    className={cn(
                      'size-6 rounded-full border-2 transition-transform',
                      draft.color === color
                        ? 'scale-110 border-ink'
                        : 'border-transparent',
                    )}
                    style={{ background: color }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
