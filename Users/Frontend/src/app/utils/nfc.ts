/** Pure Web NFC helpers shared by both frontends; no React or storage dependencies. */
export interface NfcRecord { recordType: "url" | "text"; data: string; lang?: string; encoding?: string }
export interface NfcPayload { tag_id: string; url: string; records: NfcRecord[]; offline_contact: boolean }
interface ReadRecord { recordType: string; data?: DataView; encoding?: string; lang?: string }
interface NfcReader extends EventTarget {
  write(message: { records: NfcRecord[] }, options: { signal: AbortSignal; overwrite: boolean }): Promise<void>;
  scan(options: { signal: AbortSignal }): Promise<void>;
}
type NfcWindow = Window & { NDEFReader?: new () => NfcReader };

export function nfcAvailable(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && Boolean((window as NfcWindow).NDEFReader);
}

export function validateNfcPayload(payload: NfcPayload): NfcPayload {
  const url = new URL(payload.url);
  if (!/^[A-Z0-9]{10,12}$/.test(payload.tag_id) || url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      !url.pathname.endsWith(`/tag/${payload.tag_id}`) || !Array.isArray(payload.records) ||
      payload.records.length !== (payload.offline_contact ? 2 : 1) || payload.records[0]?.recordType !== "url" || payload.records[0]?.data !== payload.url) {
    throw new Error("The server returned an invalid NFC link. Reload the tag.");
  }
  if (payload.offline_contact && (payload.records[1]?.recordType !== "text" || typeof payload.records[1]?.data !== "string" || !payload.records[1].data.trim())) {
    throw new Error("The offline contact record is invalid.");
  }
  return payload;
}

/** Exact NDEF message bytes, not a chip-memory dump. Include TLV overhead when choosing capacity. */
export function ndefBytes(payload: NfcPayload): Uint8Array {
  validateNfcPayload(payload);
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  payload.records.forEach((record, index) => {
    const data = record.recordType === "url" ? [0, ...encoder.encode(record.data)] : [2, 101, 110, ...encoder.encode(record.data)];
    const short = data.length < 256;
    bytes.push((index === 0 ? 0x80 : 0) | (index === payload.records.length - 1 ? 0x40 : 0) | (short ? 0x10 : 0) | 1, 1);
    if (short) bytes.push(data.length);
    else bytes.push((data.length >>> 24) & 255, (data.length >>> 16) & 255, (data.length >>> 8) & 255, data.length & 255);
    bytes.push(record.recordType === "url" ? 85 : 84, ...data);
  });
  return new Uint8Array(bytes);
}

export function nfcSize(payload: NfcPayload): number {
  const size = ndefBytes(payload).length;
  return size + (size >= 255 ? 4 : 2) + 1; // NFC Type 2 TLV length and terminator.
}

function reader(): NfcReader {
  const Reader = (window as NfcWindow).NDEFReader;
  if (!nfcAvailable() || !Reader) throw new Error("Use Chrome on an NFC-enabled Android phone over HTTPS, or follow the manual steps.");
  return new Reader();
}

/** Invoke directly from the button gesture; do not fetch or request permissions first. */
export function writeNfc(payload: NfcPayload, signal: AbortSignal, overwrite = false): Promise<void> {
  validateNfcPayload(payload);
  return reader().write({ records: payload.records }, { signal, overwrite });
}

export function matchesNfc(records: ReadRecord[], payload: NfcPayload): boolean {
  return records.length === payload.records.length && records.every((record, index) => {
    const expected = payload.records[index];
    if (record.recordType !== expected.recordType || !record.data) return false;
    try { return new TextDecoder(record.encoding || "utf-8", { fatal: true }).decode(record.data) === expected.data; }
    catch { return false; }
  });
}

export function verifyNfc(payload: NfcPayload, signal: AbortSignal): Promise<void> {
  validateNfcPayload(payload);
  const device = reader();
  return new Promise((resolve, reject) => {
    const stop = () => { device.removeEventListener("reading", reading); device.removeEventListener("readingerror", failure); signal.removeEventListener("abort", aborted); };
    const failure = () => { stop(); reject(new Error("The card could not be read. Keep it still and try again.")); };
    const aborted = () => { stop(); reject(new DOMException("NFC cancelled", "AbortError")); };
    const reading = (event: Event) => {
      const records = (event as Event & { message: { records: ReadRecord[] } }).message.records;
      stop();
      if (matchesNfc(records, payload)) resolve();
      else reject(new Error("This card does not match the prepared link and contact records. Do not issue it; check the card and rewrite it."));
    };
    if (signal.aborted) { aborted(); return; }
    device.addEventListener("reading", reading);
    device.addEventListener("readingerror", failure);
    signal.addEventListener("abort", aborted, { once: true });
    device.scan({ signal }).catch(error => { stop(); reject(error); });
  });
}

export function nfcError(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError") return "NFC stopped. No read-back confirmation was recorded; check the card before issuing it.";
  if (name === "NotAllowedError" || name === "SecurityError") return "NFC permission was denied. Allow NFC for this HTTPS site, then try again.";
  if (name === "NotSupportedError") return "This phone, browser or card does not support NDEF writing. Use a compatible writable NFC tag.";
  if (name === "NotReadableError" || name === "NetworkError") return "Check NFC is on, keep the card near the phone, and confirm it is writable with enough space. Existing contents need explicit replacement permission.";
  return error instanceof Error ? error.message : "NFC failed. Check the card and try again.";
}
