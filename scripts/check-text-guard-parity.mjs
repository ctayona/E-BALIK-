// Checks that the browser copy of the text rules (Users/Frontend/src/app/utils/textGuard.ts) agrees with the shared cases the Python
// rules are tested with (Server/tests/text_guard_cases.json and profanity_cases.json). Run: node scripts/check-text-guard-parity.mjs
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
// Bundle the two browser files (and the shared word list they import) so Node can run them as they are.
const out = join(mkdtempSync(join(tmpdir(), 'text-guard-')), 'guard.mjs');
await build({
  stdin: {
    contents: `export * from './textGuard.ts'; export * from './profanity.ts';`,
    resolveDir: `${root}Users/Frontend/src/app/utils`,
    loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error',
});
const guard = await import(pathToFileURL(out).href);
const cases = JSON.parse(readFileSync(`${root}Server/tests/text_guard_cases.json`, 'utf8'));

let failures = 0;
const fail = (message) => { failures += 1; console.log('FAIL', message); };

for (const c of cases.ok) {
  const problem = guard.textProblem(c.text, c.kind);
  if (problem) fail(`ok case refused: ${JSON.stringify(c)} -> ${problem}`);
}
for (const c of cases.bad) {
  if (!guard.textProblem(c.text, c.kind)) fail(`bad case accepted: ${JSON.stringify(c)}`);
}
const SENTENCE = 'Please rewrite respectfully. Inappropriate language is not permitted.';
for (const c of cases.rude) {
  const info = guard.textProblemInfo(c.text, c.kind);
  if (!info || info.code !== 'profanity' || info.message !== SENTENCE) fail(`rude case not refused as profanity: ${JSON.stringify(c)} -> ${JSON.stringify(info)}`);
}
const words = JSON.parse(readFileSync(`${root}Server/tests/profanity_cases.json`, 'utf8'));
for (const text of words.rude) {
  if (!guard.findProfanity(text)) fail(`profanity missed: ${text}`);
}
for (const text of words.clean) {
  if (guard.findProfanity(text)) fail(`profanity false alarm: ${text}`);
}
const strips = [
  ['<b>Black</b> wallet<script>alert(1)</script>', 'Black wallet'],
  ['<img src=x onerror=alert(1)>Keys', 'Keys'],
  ['<style>body{}</style>Umbrella', 'Umbrella'],
  ['&lt;script&gt;alert(1)&lt;/script&gt;Keys', 'Keys'],
  ['  A   &amp;  B  ', 'A & B'],
  ['one\r\n\r\n\r\n\r\ntwo', 'one\n\ntwo'],
  ['a\x00b\x07c', 'abc'],
  ['<b>It is my umbrella</b>, it has my name inside', 'It is my umbrella, it has my name inside'],
];
for (const [input, expected] of strips) {
  const got = guard.stripMarkup(input);
  if (got !== expected) fail(`strip ${JSON.stringify(input)} -> ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
}
if (/[<>]/.test(guard.stripMarkup('a < b > c'))) fail('angle brackets survived');
console.log(failures ? `${failures} failures` : `parity OK: ${cases.ok.length} ok, ${cases.bad.length} bad, ${cases.rude.length} rude, ${words.rude.length}+${words.clean.length} word cases, ${strips.length} strip cases`);
process.exit(failures ? 1 : 0);
