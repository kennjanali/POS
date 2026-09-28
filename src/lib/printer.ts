/**
 * Receipt printing. In the Android app, receipts go to a paired Bluetooth
 * thermal printer as ESC/POS bytes (see BluetoothPrinterPlugin.java). The web
 * demo has no Bluetooth and uses the browser's print dialog instead.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

export type PaperWidth = 58 | 80;

export interface ReceiptPrinter {
  name: string;
  address: string;
  width: PaperWidth;
}

/** Characters per line in a thermal printer's default font. */
export const COLUMNS: Record<PaperWidth, number> = { 58: 32, 80: 48 };

interface PairedDevice {
  name: string;
  address: string;
}

interface BluetoothPrinterPlugin {
  listPaired(): Promise<{ devices: PairedDevice[] }>;
  print(options: { address: string; data: string }): Promise<void>;
}

const BluetoothPrinter = registerPlugin<BluetoothPrinterPlugin>('BluetoothPrinter');

export const canPrintBluetooth = (): boolean => Capacitor.isNativePlatform();

/** Printers paired in Android's Bluetooth settings. */
export async function listPairedPrinters(): Promise<PairedDevice[]> {
  return (await BluetoothPrinter.listPaired()).devices;
}

export async function printText(printer: ReceiptPrinter, text: string): Promise<void> {
  await BluetoothPrinter.print({ address: printer.address, data: toBase64(escpos(text)) });
}

/**
 * Print a slip wherever this device prints: the paired Bluetooth printer in
 * the Android app, the browser's print dialog on the web. Rejects with a
 * message fit for a toast.
 */
export async function printSlip(text: string, printer: ReceiptPrinter | null): Promise<void> {
  if (canPrintBluetooth()) {
    if (!printer) throw new Error('Choose a receipt printer in Settings first.');
    await printText(printer, text);
    return;
  }
  const win = window.open('', '_blank', 'width=380,height=640');
  if (!win) throw new Error('The browser blocked the print window.');
  win.document.write(
    '<html><head><title>Print</title><style>' +
      'body{font:12px/1.65 ui-monospace,Menlo,monospace;padding:16px;white-space:pre}' +
      '</style></head><body></body></html>',
  );
  win.document.body.textContent = text;
  win.document.close();
  win.focus();
  win.print();
}

/**
 * Cheap thermal printers have no dependable code page for ñ or ₱, and print
 * garbage for them. Fold to plain ASCII: accents dropped, ₱ as P, a dash as
 * a hyphen, anything else unprintable as ?.
 */
export function toPrintable(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/₱/g, 'P')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7e\n]/g, '?');
}

const ESC = 0x1b;
const GS = 0x1d;

/** Reset, the text, feed past the tear bar, cut (ignored without a cutter). */
export function escpos(text: string): Uint8Array {
  const body = new TextEncoder().encode(toPrintable(text) + '\n');
  return new Uint8Array([ESC, 0x40, ...body, ESC, 0x64, 4, GS, 0x56, 0x01]);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
