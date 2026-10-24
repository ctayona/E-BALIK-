// A type-check "ratchet" for the user app. The app has a known number of older type errors (Users/Frontend/typecheck-baseline.json).
// This fails when the count GROWS, so new code cannot add errors, and tells you when it shrinks so the baseline can be lowered.
// Run: npm run typecheck:user        (CI runs it on every push)
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const baselineFile = join(root, 'Users/Frontend/typecheck-baseline.json');
const tsc = ['Admin/Frontend/node_modules/typescript/bin/tsc', 'node_modules/typescript/bin/tsc'].map((p) => join(root, p)).find(existsSync);
if (!tsc) {
  console.error('TypeScript was not found. Run: npm install --prefix Admin/Frontend');
  process.exit(2);
}

const run = spawnSync(process.execPath, [tsc, '-p', join(root, 'Users/Frontend/tsconfig.typecheck.json')], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const output = `${run.stdout || ''}${run.stderr || ''}`;
const errors = output.split('\n').filter((line) => /error TS\d+:/.test(line));
const baseline = JSON.parse(readFileSync(baselineFile, 'utf8')).errors;

// A crash (no output, bad config) is not "zero errors".
if (run.error || (run.status !== 0 && errors.length === 0)) {
  console.error('The type-check did not run properly:\n' + output.slice(0, 2000));
  process.exit(2);
}

const summary = [`### User app type check`, `${errors.length} errors now, baseline ${baseline}.`];
let code = 0;
if (errors.length > baseline) {
  code = 1;
  summary.push(`**${errors.length - baseline} new error(s).** Fix them, or the build quality drifts. The newest ones:`, '```', ...errors.slice(-15).map((l) => l.slice(0, 220)), '```');
} else if (errors.length < baseline) {
  summary.push(`Fewer errors than the baseline. Lower "errors" to ${errors.length} in Users/Frontend/typecheck-baseline.json so it cannot creep back up.`);
}
const text = summary.join('\n');
console.log(text.replace(/^### /, ''));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
process.exit(code);
