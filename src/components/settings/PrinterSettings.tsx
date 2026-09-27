'use client';

import { useState } from 'react';
import { Printer } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/components/ui/cn';
import {
  canPrintBluetooth,
  COLUMNS,
  listPairedPrinters,
  printText,
  type PaperWidth,
  type ReceiptPrinter,
} from '@/lib/printer';
import { usePos } from '@/store/usePos';

const WIDTHS: PaperWidth[] = [58, 80];

/**
 * Pick the paired Bluetooth printer and its paper width. Pairing itself
 * happens once in Android's Bluetooth settings, as with any Bluetooth device.
 */
export function PrinterSettings() {
  const printer = usePos((s) => s.settings.printer ?? null);
  const businessName = usePos((s) => s.settings.businessName);
  const updateSettings = usePos((s) => s.updateSettings);
  const [paired, setPaired] = useState<{ name: string; address: string }[] | null>(null);
  const [busy, setBusy] = useState(false);

  if (!canPrintBluetooth()) {
    return (
      <p className="text-[12px] leading-relaxed text-ink-2">
        Receipts print through the browser&apos;s print dialog here. Bluetooth receipt printers
        work in the Android app.
      </p>
    );
  }

  const save = (next: ReceiptPrinter | null) => {
    const result = updateSettings({ printer: next });
    if (!result.ok) toast(result.error, 'danger');
  };

  async function run(task: () => Promise<void>) {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Something went wrong.', 'danger');
    } finally {
      setBusy(false);
    }
  }

  const findPrinters = () =>
    run(async () => {
      const devices = await listPairedPrinters();
      setPaired(devices);
      if (devices.length === 0) toast('No paired devices. Pair the printer in Android settings first.', 'danger');
    });

  const testPrint = () =>
    run(async () => {
      if (!printer) return;
      const rule = '-'.repeat(COLUMNS[printer.width]);
      await printText(printer, `${businessName}\n${rule}\nPrinter test OK\n${printer.width} mm paper\n${rule}`);
      toast('Test receipt sent.', 'success');
    });

  return (
    <div className="flex flex-col gap-3">
      {printer ? (
        <div className="flex items-center gap-2.5 rounded-md border border-line bg-raised px-3 py-2.5">
          <Printer size={16} className="shrink-0 text-accent" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">{printer.name}</span>
            <span className="block text-[11px] text-ink-3">{printer.address}</span>
          </span>
        </div>
      ) : (
        <p className="text-[12px] leading-relaxed text-ink-2">
          Pair the printer in Android&apos;s Bluetooth settings, then choose it here.
        </p>
      )}

      {printer && (
        <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Paper width">
          {WIDTHS.map((width) => (
            <button
              key={width}
              type="button"
              role="radio"
              aria-checked={printer.width === width}
              onClick={() => save({ ...printer, width })}
              className={cn(
                'min-h-11 rounded-md border text-[13px] font-semibold transition-colors',
                printer.width === width
                  ? 'border-accent bg-accent text-white'
                  : 'border-line bg-raised hover:border-accent',
              )}
            >
              {width} mm paper
            </button>
          ))}
        </div>
      )}

      {paired && paired.length > 0 && (
        <ul className="flex list-none flex-col gap-1.5 p-0">
          {paired.map((device) => (
            <li key={device.address}>
              <button
                type="button"
                onClick={() => {
                  save({ ...device, width: printer?.width ?? 58 });
                  setPaired(null);
                }}
                className="flex min-h-11 w-full items-center justify-between rounded-md border border-line bg-raised px-3 text-left text-[13px] font-semibold hover:border-accent"
              >
                {device.name}
                <span className="text-[11px] font-normal text-ink-3">{device.address}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <Button variant="secondary" fullWidth disabled={busy} onClick={findPrinters}>
          {printer ? 'Change printer' : 'Choose printer'}
        </Button>
        {printer && (
          <Button variant="secondary" fullWidth disabled={busy} onClick={testPrint}>
            Test print
          </Button>
        )}
      </div>
    </div>
  );
}
