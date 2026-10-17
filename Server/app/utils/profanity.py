"""Foul-word filter for user-written text (English and Filipino).

Matching works on whole words after normalising common tricks (letter swaps like "f4ck", repeated letters,
spacing out letters, joining two words). Short words are matched as whole words only, so ordinary words that
merely contain them ("class", "assistant", "Scunthorpe") are not flagged.
"""
import json
import re
import unicodedata
from pathlib import Path
from typing import Iterable, List, Optional

# The word lists live in profanity_terms.json, which the browser reads too (Users/Frontend/src/app/utils/profanity.ts), so the live warning
# while typing and the server never disagree. Kept deliberately to clearly abusive terms. Add words there; they are matched after normalisation.
_TERMS_FILE = Path(__file__).with_name('profanity_terms.json')
_LISTS = json.loads(_TERMS_FILE.read_text(encoding='utf-8'))
_ENGLISH: List[str] = list(_LISTS['english'])
_FILIPINO: List[str] = list(_LISTS['filipino'])

# What the person is told when text is refused. The browser shows the same sentence.
PROFANITY_MESSAGE = 'Please rewrite respectfully. Inappropriate language is not permitted.'

_LEET = str.maketrans({'0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's'})
_LONG_TERM_MIN = 7  # long terms are also found inside a run of letters ("putanginamo")


def _fold(text: str) -> str:
    text = unicodedata.normalize('NFKD', text or '')
    text = ''.join(ch for ch in text if not unicodedata.combining(ch)).lower()
    text = re.sub(r'(?<=[a-z])!(?=[a-z])', 'i', text)  # "sh!t" but not the "!" after "bobo!"
    return text.translate(_LEET)


def _collapse(word: str) -> str:
    """'fuuuck' -> 'fuck'; terms are collapsed the same way so both sides compare equal."""
    return re.sub(r'(.)\1+', r'\1', word)


_TERMS = {_collapse(re.sub(r'[^a-z]', '', _fold(term))) for term in _ENGLISH + _FILIPINO}
_LONG_TERMS = {term for term in _TERMS if len(term) >= _LONG_TERM_MIN}


def find_profanity(text: str) -> Optional[str]:
    """Return the first matched foul word (as the user wrote it, folded) or None."""
    folded = _fold(text)
    if not folded.strip():
        return None
    tokens: List[str] = re.findall(r'[a-z]+', folded)
    candidates: List[str] = list(tokens)
    candidates += [a + b for a, b in zip(tokens, tokens[1:])]                    # "putang ina"
    candidates += [a + b + c for a, b, c in zip(tokens, tokens[1:], tokens[2:])]  # "putang ina mo"
    run: List[str] = []
    for token in tokens + ['']:                                                  # "f u c k"
        if len(token) == 1:
            run.append(token)
            continue
        if len(run) >= 3:
            candidates.append(''.join(run))
        run = []
    for candidate in candidates:
        if _collapse(candidate) in _TERMS:
            return candidate
    squashed = _collapse(''.join(tokens))
    for term in _LONG_TERMS:
        if term in squashed:
            return term
    return None


def contains_profanity(text: str) -> bool:
    return find_profanity(text) is not None


def first_profane(values: Iterable[str]) -> Optional[str]:
    for value in values:
        hit = find_profanity(value)
        if hit:
            return hit
    return None
