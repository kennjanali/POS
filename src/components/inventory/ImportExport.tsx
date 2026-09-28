'use client';

import { useRef, useState } from 'react';
import { Download, FileUp } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { PRODUCT_SLUG } from '@/lib/brand';
import { csvTemplate, exportProducts, previewImport, type ImportPreview } from '@/lib/csv';
import { businessDate, peso } from '@/lib/format';
import { SAVE_LOCATION, saveTextFile } from '@/lib/files';
import { sortProducts } from '@/lib/products';
import { usePos } from '@/store/usePos';

/**
 * Inventory in and out of the app as a spreadsheet.
 *
 * The screen is the point. An import is somebody's whole stock list — the
 * thing they typed once, in the file they keep on their laptop — and a
 * half-applied version of it would be worse than none: prices half changed,
 * items doubled. So nothing is written until the owner has read what the file
 * says will happen, and the rows it could not read are named by line number.
 */
export function ImportExport() {
  const products = usePos((s) => s.products);
  const stock = usePos((s) => s.stock);
  const branchId = usePos((s) => s.activeBranchId);
  const features = usePos((s) => s.settings.features);
  const currency = usePos((s) => s.settings.currency);
  const applyImport = usePos((s) => s.applyImport);

  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fileName, setFileName] = useState('');

  async function save(text: string, name: string) {
    try {
      await saveTextFile(name, text, 'text/csv');
    } catch {
      toast(`The file could not be saved. Check ${SAVE_LOCATION}.`, 'danger');
      return false;
    }
    return true;
  }

  async function exportNow() {
    const active = sortProducts(products).filter((p) => p.active);
    const name = `${PRODUCT_SLUG}-products-${businessDate(Date.now())}.csv`;
    if (await save(exportProducts(active, stock[branchId] ?? {}), name)) {
      toast(`Saved ${name} to ${SAVE_LOCATION}`, 'success');
    }
  }

  function read(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      setFileName(file.name);
      setPreview(previewImport(String(reader.result), products, features, stock[branchId] ?? {}));
    };
    reader.onerror = () => toast('Could not read that file', 'danger');
    reader.readAsText(file);
  }

  const added = preview?.rows.filter((r) => r.matchId === null).length ?? 0;
  const updated = (preview?.rows.length ?? 0) - added;

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void save(csvTemplate(), `${PRODUCT_SLUG}-products-template.csv`).then((ok) => {
              if (ok) toast('Template saved. Fill in the rows and import it.', 'success');
            })
          }
        >
          Template
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void exportNow()}>
          <Download size={14} aria-hidden />
          Export
        </Button>
        <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
          <FileUp size={14} aria-hidden />
          Import
        </Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) read(file);
          // The same file twice in a row is a normal thing to want.
          e.target.value = '';
        }}
      />

      <Modal
        open={preview !== null}
        onClose={() => setPreview(null)}
        title="Import items"
        width="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPreview(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!preview) return;
                const result = applyImport(preview);
                if (!result.ok) {
                  toast(result.error, 'danger');
                  return;
                }
                setPreview(null);
                toast(`Imported ${added + updated} items: ${added} added, ${updated} updated`, 'success');
              }}
              disabled={preview?.rows.length === 0}
            >
              Import the good rows
            </Button>
          </>
        }
      >
        {preview && (
          <div className="flex flex-col gap-4">
            <ImportSummary preview={preview} fileName={fileName} currency={currency} />
            <p className="text-[11.5px] leading-relaxed text-ink-3">
              An item already in Inventory — the same SKU, or the same name when it has no
              SKU — is updated: price, cost, category, unit and reorder level. It keeps the
              stock it was counted at. Any other item is added, and its opening quantity is
              booked as opening stock.
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}

/**
 * What a file will do, before it does it: the rows that read cleanly, the
 * ones that did not (by line number), and a look at the first few. Shared by
 * Inventory and the setup wizard.
 */
export function ImportSummary({
  preview,
  fileName,
  currency,
}: {
  preview: ImportPreview;
  fileName: string;
  currency: string;
}) {
  const added = preview.rows.filter((r) => r.matchId === null).length;
  const updated = preview.rows.length - added;
  const { errors } = preview;
  // One bad line can have several problems; the count is of lines.
  const badRows = new Set(errors.map((e) => e.row)).size;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px]">
        <span className="font-bold">{fileName}</span>
        <span className="text-ink-2"> · </span>
        <strong>
          {preview.rows.length} row{preview.rows.length === 1 ? '' : 's'} ready
        </strong>
        <span className="text-ink-2">
          {' '}
          ({added} added, {updated} updated)
        </span>
      </p>

      {errors.length > 0 ? (
        <div className="rounded-md border border-warn/40 bg-warn/5 p-3">
          <p className="mb-1.5 text-[12.5px] font-bold text-warn">
            {badRows} row{badRows === 1 ? '' : 's'} could not be read
          </p>
          <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-[12px]">
            {errors.map((e, i) => (
              <li key={`${e.row}-${i}`} className="text-ink-2">
                <span className="tnum font-semibold">Row {e.row}</span> — {e.message}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11.5px] text-ink-3">
            Fix them in the file and open it again, or import the rest now. Nothing in a
            skipped row is written.
          </p>
        </div>
      ) : (
        <p className="text-[12.5px] text-ink-2">Every row reads cleanly.</p>
      )}

      <section>
        <h3 className="mb-1.5 text-[10.5px] font-bold tracking-wide text-ink-3 uppercase">
          First rows
        </h3>
        {preview.rows.length === 0 ? (
          <p className="text-[12.5px] text-ink-3">
            There is nothing to import yet. Fill in the template and open it again.
          </p>
        ) : (
          <ul className="flex list-none flex-col gap-1 p-0">
            {preview.rows.slice(0, 6).map((row) => (
              <li
                key={row.row}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-line bg-raised px-2.5 py-1.5 text-[12px]"
              >
                <span className="min-w-0 truncate">
                  {row.product.name}
                  {row.product.sku && <span className="ml-1.5 text-ink-3">{row.product.sku}</span>}
                </span>
                <span className="tnum flex shrink-0 items-center gap-2 text-ink-2">
                  <span>{peso(row.product.priceCents, currency)}</span>
                  <span className={row.matchId === null ? 'font-semibold text-accent' : 'text-ink-3'}>
                    {row.matchId === null ? 'new' : 'updates an item'}
                  </span>
                </span>
              </li>
            ))}
            {preview.rows.length > 6 && (
              <li className="text-[11.5px] text-ink-3">and {preview.rows.length - 6} more</li>
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
