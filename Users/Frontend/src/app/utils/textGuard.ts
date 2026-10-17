/**
 * Input checks for typed text, the browser copy of `Server/app/utils/text_guard.py`.
 *
 * It exists to show a hint while the person types, before anything is sent. The server runs the same rules, including the foul-language
 * filter (`./profanity.ts`, the same word list), and is the one that counts. `Server/tests/text_guard_cases.json` holds the shared cases both sides must agree on.
 */
import { PROFANITY_MESSAGE, findProfanity } from './profanity';

export type TextKind = 'title' | 'description' | 'place' | 'marks' | 'reason' | 'comment' | 'name';

export const TEXT_RULES: Record<TextKind, { min: number; max: number; noun: string }> = {
  title: { min: 3, max: 120, noun: 'item title' },
  description: { min: 15, max: 1000, noun: 'description' },
  place: { min: 3, max: 150, noun: 'place' },
  marks: { min: 3, max: 500, noun: 'details' },
  reason: { min: 15, max: 1000, noun: 'explanation' },
  comment: { min: 2, max: 500, noun: 'comment' },
  name: { min: 2, max: 60, noun: 'name' },
};

const KEYBOARD_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const MASH = new Set<string>();
for (const row of KEYBOARD_ROWS) {
  for (const text of [row, [...row].reverse().join('')]) {
    for (let index = 0; index + 5 <= text.length; index += 1) MASH.add(text.slice(index, index + 5));
  }
}
const VOWELS = new Set('aeiouy');
const NAME_ALLOWED = /^\p{L}+(?:(?:\. ?|[ '’-])\p{L}+)*\.?$/u;
const SCRIPT_BLOCK = /<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const TAG = /<[^>]*>/g;
const GAP = '';
const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const length = (text: string) => [...text].length;

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Remove tags (and what is inside script and style), decode entities so an escaped tag cannot slip through, drop control characters and tidy the spaces. */
export function stripMarkup(value: unknown): string {
  let text = String(value ?? '').split(GAP).join('');
  for (let pass = 0; pass < 2; pass += 1) {
    text = decodeEntities(text).replace(SCRIPT_BLOCK, GAP).replace(TAG, GAP);
  }
  text = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').replace(/[<>]/g, GAP);
  text = text.replace(new RegExp(`\\s*${GAP}+\\s*(?=[,.;:!?)\\]])`, 'g'), '').replace(new RegExp(`${GAP}+`, 'g'), ' ');
  text = text.replace(/\r/g, '').replace(/[ \t ]+/g, ' ').replace(/ ?\n ?/g, '\n');
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

const wordsOf = (text: string) => text.toLowerCase().match(/\p{L}+/gu) ?? [];

/** Why this looks like keyboard mash or spam, or null. Patterns only, never word lists. */
export function gibberishReason(text: string): string | null {
  const lowered = text.toLowerCase();
  const compact = lowered.replace(/[^\p{L}\p{N}_]+/gu, '');
  if (/(\p{L})\1{4,}/u.test(compact) || /(\p{Nd})\1{7,}/u.test(compact)) return 'repeated';
  if (/(\p{L}{2,3})\1{3,}/u.test(compact)) return 'repeated';
  const words = wordsOf(lowered);
  for (const word of words) {
    const letters = [...word];
    if (letters.length >= 5) {
      for (const chunk of MASH) if (word.includes(chunk)) return 'mash';
    }
    if (letters.length >= 6 && !letters.some((letter) => VOWELS.has(letter))) return 'no_vowels';
    let run = 0;
    for (const letter of letters) {
      run = VOWELS.has(letter) ? 0 : run + 1;
      if (run >= 6) return 'consonants';
    }
  }
  for (let index = 0; index + 4 <= words.length; index += 1) {
    if (new Set(words.slice(index, index + 4)).size === 1) return 'repeated_word';
  }
  const letters = lowered.replace(/[^\p{L}]+/gu, '');
  if (length(compact) >= 10 && new Set(compact).size <= 3) return 'repeated';
  if (length(letters) >= 8 && new Set(letters).size <= 2) return 'repeated';
  return null;
}

export type TextProblemCode = 'empty' | 'short' | 'long' | 'characters' | 'words' | 'random' | 'profanity';

/** What is wrong with a text, or null. `code` lets a form wait for the person to finish typing before it complains about length. */
export function textProblemInfo(value: unknown, kind: TextKind, label = '', required = true): { message: string; code: TextProblemCode } | null {
  const rule = TEXT_RULES[kind];
  const noun = label || rule.noun;
  const text = stripMarkup(value);
  if (!text) return required ? { message: `Enter the ${noun}.`, code: 'empty' } : null;
  if (kind === 'name' && !NAME_ALLOWED.test(text)) return { message: `Use letters only in your ${noun} (spaces, hyphens and apostrophes are fine).`, code: 'characters' };
  if (length(text) < rule.min) return { message: `The ${noun} is too short. Write at least ${rule.min} characters.`, code: 'short' };
  if (length(text) > rule.max) return { message: `The ${noun} is too long. Keep it to ${rule.max} characters or less.`, code: 'long' };
  const letters = length(text.replace(/[^\p{L}]+/gu, ''));
  if ((kind === 'description' || kind === 'reason' || kind === 'comment') && letters < Math.max(2, Math.floor(length(text.replace(/\s+/g, '')) * 0.5))) {
    return { message: `The ${noun} needs real words, not just numbers and symbols.`, code: 'words' };
  }
  if ((kind === 'title' || kind === 'place' || kind === 'marks') && letters < 2) return { message: `The ${noun} needs real words, not just numbers and symbols.`, code: 'words' };
  if (gibberishReason(text)) {
    return { message: kind === 'name' ? `This does not look like a real ${noun}. Please check the spelling.` : `This looks like random typing. Please rewrite the ${noun} in your own words.`, code: 'random' };
  }
  if (findProfanity(text)) return { message: PROFANITY_MESSAGE, code: 'profanity' };
  return null;
}

/** The message for a text that is not acceptable, or '' when it is fine. `label` names the field in the message ("description"). */
export const textProblem = (value: unknown, kind: TextKind, label = '', required = true): string => textProblemInfo(value, kind, label, required)?.message ?? '';

/** Check several fields at once. Returns the first problem as `{ field, message }`, or null when every field is fine. */
export function firstTextProblem(
  checks: Array<{ field: string; value: unknown; kind: TextKind; label?: string; required?: boolean }>,
): { field: string; message: string } | null {
  for (const check of checks) {
    const message = textProblem(check.value, check.kind, check.label ?? '', check.required ?? true);
    if (message) return { field: check.field, message };
  }
  return null;
}
