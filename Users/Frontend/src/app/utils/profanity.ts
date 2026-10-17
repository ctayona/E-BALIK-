/**
 * Foul-word filter, the browser copy of `Server/app/utils/profanity.py`. It reads the same word list (`Server/app/utils/profanity_terms.json`)
 * and applies the same steps, so the warning shown while someone types matches what the server will refuse.
 * The server is the one that counts; `Server/tests/profanity_cases.json` holds the cases both sides must agree on.
 */
import terms from '../../../../../Server/app/utils/profanity_terms.json';

/** What the person is told when text is refused. The server sends the same sentence. */
export const PROFANITY_MESSAGE = 'Please rewrite respectfully. Inappropriate language is not permitted.';

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', $: 's' };
const LONG_TERM_MIN = 7; // long terms are also found inside a run of letters ("putanginamo")

function fold(text: string): string {
  const lowered = (text || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  return lowered.replace(/(?<=[a-z])!(?=[a-z])/g, 'i').replace(/[0134578@$]/g, (char) => LEET[char] ?? char);
}

/** 'fuuuck' -> 'fuck'; terms are collapsed the same way so both sides compare equal. */
const collapse = (word: string) => word.replace(/(.)\1+/g, '$1');

const TERMS = new Set<string>([...terms.english, ...terms.filipino].map((term) => collapse(fold(term).replace(/[^a-z]/g, ''))));
const LONG_TERMS = [...TERMS].filter((term) => term.length >= LONG_TERM_MIN);

/** The first foul word found (as written, folded), or null. */
export function findProfanity(text: string): string | null {
  const folded = fold(text);
  if (!folded.trim()) return null;
  const tokens = folded.match(/[a-z]+/g) ?? [];
  const candidates: string[] = [...tokens];
  for (let index = 0; index + 1 < tokens.length; index += 1) candidates.push(tokens[index] + tokens[index + 1]); // "putang ina"
  for (let index = 0; index + 2 < tokens.length; index += 1) candidates.push(tokens[index] + tokens[index + 1] + tokens[index + 2]); // "putang ina mo"
  let run: string[] = [];
  for (const token of [...tokens, '']) { // "f u c k"
    if (token.length === 1) {
      run.push(token);
      continue;
    }
    if (run.length >= 3) candidates.push(run.join(''));
    run = [];
  }
  for (const candidate of candidates) {
    if (TERMS.has(collapse(candidate))) return candidate;
  }
  const squashed = collapse(tokens.join(''));
  for (const term of LONG_TERMS) {
    if (squashed.includes(term)) return term;
  }
  return null;
}

export const containsProfanity = (text: string) => findProfanity(text) !== null;
