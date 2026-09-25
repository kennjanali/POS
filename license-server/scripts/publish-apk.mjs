// Upload the signed release APK so logged-in customers can download it.
// Build it first (`npm run android:apk` in the app), then:
//   node scripts/publish-apk.mjs            → the live site
//   node scripts/publish-apk.mjs --local    → `wrangler dev`
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const apk = fileURLToPath(new URL('../../android/app/build/outputs/apk/release/app-release.apk', import.meta.url));
const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const metadata = { version, size: statSync(apk).size, uploaded: Date.now() };

// Wrangler's own entry point with node, not npx: no shell to mangle the JSON.
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
execFileSync(
  process.execPath,
  [wrangler, 'kv', 'key', 'put', 'android/pos034.apk', '--binding', 'RELEASES', '--path', apk,
    '--metadata', JSON.stringify(metadata), process.argv.includes('--local') ? '--local' : '--remote'],
  { stdio: 'inherit' },
);
console.log(`Published POS@034 ${version} (${(metadata.size / 1048576).toFixed(1)} MB).`);
