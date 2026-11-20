// No network, database, browser or physical NFC adapter. Exercise the real pure helpers.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { test } from 'node:test';
const source = await readFile(new URL('../Users/Frontend/src/app/utils/nfc.ts', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'ts', format: 'esm' });
const nfc = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const payload = { tag_id: 'ABCDEFGHJK23', url: 'https://ebalik.example/tag/ABCDEFGHJK23', offline_contact: false,
  records: [{ recordType: 'url', data: 'https://ebalik.example/tag/ABCDEFGHJK23' }] };
const textPayload = { ...payload, offline_contact: true, records: [...payload.records, { recordType: 'text', data: 'Name: María\nPhone: 09171234567', lang: 'en', encoding: 'utf-8' }] };
const records = p => p.records.map(r => ({ ...r, data: new DataView(new TextEncoder().encode(r.data).buffer) }));
let instance;
class Reader extends EventTarget {
  constructor() { super(); instance = this; }
  write(message, options) { this.message = message; this.options = options; return Promise.resolve(); }
  scan(options) { this.options = options; return Promise.resolve(); }
  emit(records) { const e = new Event('reading'); e.message = { records }; this.dispatchEvent(e); }
}
function setup() { globalThis.window = { isSecureContext: true, NDEFReader: Reader }; }

test('unsupported and insecure environments use the fallback', () => {
  globalThis.window = { isSecureContext: true };
  assert.equal(nfc.nfcAvailable(), false);
  globalThis.window = { isSecureContext: false, NDEFReader: Reader };
  assert.equal(nfc.nfcAvailable(), false);
  setup(); assert.equal(nfc.nfcAvailable(), true);
});
test('invalid scheme, credentials, mismatched IDs and extra records are refused', () => {
  for (const invalid of [{ ...payload, url: 'javascript:alert(1)' }, { ...payload, tag_id: 'WRONGCODE123' },
    { ...payload, url: 'https://user:password@ebalik.example/tag/ABCDEFGHJK23' },
    { ...payload, records: [...payload.records, { recordType: 'text', data: 'secret' }] }]) {
    assert.throws(() => nfc.validateNfcPayload(invalid));
  }
});
test('URL-only encoding is a single standard URI record and never a bare ID', () => {
  const bytes = nfc.ndefBytes(payload);
  assert.deepEqual([...bytes.slice(0, 5)], [0xd1, 1, payload.url.length + 1, 0x55, 0]);
  assert.equal(new TextDecoder().decode(bytes.slice(5)), payload.url);
  assert.equal(nfc.nfcSize(payload), bytes.length + 3);
});
test('offline text is the second NDEF record with UTF-8 bytes and English language', () => {
  const bytes = nfc.ndefBytes(textPayload);
  const offset = 5 + new TextEncoder().encode(payload.url).length;
  assert.equal(bytes[0], 0x91);
  assert.deepEqual([...bytes.slice(offset, offset + 7)], [0x51, 1, new TextEncoder().encode(textPayload.records[1].data).length + 3, 0x54, 2, 101, 110]);
  assert.equal(new TextDecoder().decode(bytes.slice(offset + 7)), textPayload.records[1].data);
});
test('long contact records use a four-byte NDEF length and extended TLV capacity', () => {
  const p = { ...textPayload, records: [payload.records[0], { recordType: 'text', data: 'é'.repeat(150) }] };
  const bytes = nfc.ndefBytes(p);
  const offset = 5 + payload.url.length;
  assert.deepEqual([...bytes.slice(offset, offset + 6)], [0x41, 1, 0, 0, 1, 47]);
  assert.equal(nfc.nfcSize(p), bytes.length + 5);
});
test('writing protects existing card contents unless replacement was explicitly selected', async () => {
  setup(); const controller = new AbortController();
  await nfc.writeNfc(payload, controller.signal);
  assert.equal(instance.options.overwrite, false);
  assert.equal(instance.options.signal, controller.signal);
  assert.deepEqual(instance.message.records, payload.records);
  await nfc.writeNfc(payload, controller.signal, true);
  assert.equal(instance.options.overwrite, true);
});
test('read-back accepts the exact message', async () => {
  setup(); const controller = new AbortController();
  const reading = nfc.verifyNfc(textPayload, controller.signal);
  instance.emit(records(textPayload)); await reading;
});
test('read-back rejects another tag, extra personal data and reordered records', async () => {
  for (const incoming of [records({ ...payload, records: [{ recordType: 'url', data: 'https://other.example' }] }), records(textPayload), []]) {
    setup(); const reading = nfc.verifyNfc(payload, new AbortController().signal);
    instance.emit(incoming); await assert.rejects(reading, /does not match/);
  }
  assert.equal(nfc.matchesNfc(records(textPayload).reverse(), textPayload), false);
});
test('cancellation rejects without reporting verification success', async () => {
  setup(); const controller = new AbortController();
  const reading = nfc.verifyNfc(payload, controller.signal);
  controller.abort(); await assert.rejects(reading, { name: 'AbortError' });
});
test('an already aborted request never starts scanning', async () => {
  setup(); const controller = new AbortController(); controller.abort();
  await assert.rejects(nfc.verifyNfc(payload, controller.signal), { name: 'AbortError' });
  assert.equal(instance.options, undefined);
});
test('read failure stops with an actionable error', async () => {
  setup(); const reading = nfc.verifyNfc(payload, new AbortController().signal);
  instance.dispatchEvent(new Event('readingerror')); await assert.rejects(reading, /could not be read/);
});
test('permission, unsupported card and interrupted write errors stay failures', () => {
  assert.match(nfc.nfcError(new DOMException('', 'NotAllowedError')), /permission was denied/);
  assert.match(nfc.nfcError(new DOMException('', 'NotSupportedError')), /compatible writable NFC tag/);
  assert.match(nfc.nfcError(new DOMException('', 'AbortError')), /No read-back confirmation/);
});
