/**
 * Saving a file off the app: backups and monthly archives.
 *
 * The browser gets a download. The Android WebView silently ignores that
 * trick, so the app writes a real file to the tablet's public
 * Documents/POS034 folder instead — public so it survives uninstalling the
 * app, which deletes everything in the app's own storage.
 */

import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const FOLDER = 'POS034';

/** Where saved files end up, in words the owner can find. */
export const SAVE_LOCATION = Capacitor.isNativePlatform() ? 'Documents › POS034' : 'Downloads';

/** Save a JSON file. Rejects if it did not land, so no caller records a backup that never happened. */
export async function saveJsonFile(name: string, value: unknown): Promise<void> {
  await saveTextFile(name, JSON.stringify(value), 'application/json');
}

/** Save a plain-text file, e.g. a quotation the customer takes away. */
export async function saveTextFile(
  name: string,
  contents: string,
  type = 'text/plain',
): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    // Android 10 asks for storage permission; 11+ grants it for the app's own files.
    if ((await Filesystem.checkPermissions()).publicStorage !== 'granted') {
      const asked = await Filesystem.requestPermissions();
      if (asked.publicStorage !== 'granted') throw new Error('Storage permission was not granted.');
    }
    await Filesystem.writeFile({
      path: `${FOLDER}/${name}`,
      data: contents,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    return;
  }

  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  // Revoking in the same tick can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const canShareFiles = (): boolean => Capacitor.isNativePlatform();

/** Open Android's share sheet for a saved file — Drive, Gmail, Messenger. */
export async function shareSavedFile(name: string): Promise<void> {
  const { uri } = await Filesystem.getUri({ path: `${FOLDER}/${name}`, directory: Directory.Documents });
  await Share.share({ title: name, files: [uri] });
}
