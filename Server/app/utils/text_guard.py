"""Input checks for the free text people type into forms: titles, descriptions, places, claim reasons, comments and names.

Every text field goes through `clean_field`, which (1) strips HTML and script tags, (2) tidies spaces, (3) enforces a meaningful length for the
kind of field, (4) refuses keyboard mash and spam ("aaaaa", "asdfghjkl", "hahahahaha", one word repeated), and (5) refuses foul language.
The browser runs the same length and gibberish rules (`Users/Frontend/src/app/utils/textGuard.ts`, same test cases) to show hints while the
person types; this module is the one that counts, because anything can call the API directly.

Real items must never be refused: the rules look for patterns no real description has, not for unusual words.
"""
import html
import re
from typing import Any, Dict, Optional

from app.utils.profanity import PROFANITY_MESSAGE, find_profanity


class TextRejected(Exception):
    """The text was refused. `message` is written for the person, `field` is the form field it belongs to.
    Not a ValueError on purpose: several routes turn ValueError into a 401, which would log the person out of the form."""

    def __init__(self, message: str, field: str = '', code: str = 'invalid_text'):
        super().__init__(message)
        self.message, self.field, self.code = message, field, code
        self.status = 400

    def body(self) -> Dict[str, Any]:
        return {'error': self.message, 'code': self.code, **({'field': self.field} if self.field else {})}


# kind -> (shortest, longest, what it is called in a message)
RULES: Dict[str, Dict[str, Any]] = {
    'title': {'min': 3, 'max': 120, 'noun': 'item title'},
    'description': {'min': 15, 'max': 1000, 'noun': 'description'},
    'place': {'min': 3, 'max': 150, 'noun': 'place'},
    'marks': {'min': 3, 'max': 500, 'noun': 'details'},
    'reason': {'min': 15, 'max': 1000, 'noun': 'explanation'},
    'comment': {'min': 2, 'max': 500, 'noun': 'comment'},
    'name': {'min': 2, 'max': 60, 'noun': 'name'},
}

_SCRIPT_BLOCK = re.compile(r'<\s*(script|style)\b[^>]*>.*?<\s*/\s*\1\s*>', re.I | re.S)
_TAG = re.compile(r'<[^>]*>')
_CONTROL = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')
_KEYBOARD_ROWS = ('qwertyuiop', 'asdfghjkl', 'zxcvbnm')
_MASH = tuple({row[i:i + 5] for row in _KEYBOARD_ROWS for i in range(len(row) - 4)} | {row[::-1][i:i + 5] for row in _KEYBOARD_ROWS for i in range(len(row) - 4)})
_VOWELS = set('aeiouy')
_GAP = '\ue000'   # stands in for a removed tag until the spaces are tidied
_NAME_ALLOWED = re.compile(r"^[^\W\d_]+(?:(?:\. ?|[ '’-])[^\W\d_]+)*\.?$", re.U)


def strip_markup(value: Any) -> str:
    """Remove tags (and what is inside <script> and <style>), decode entities once so an escaped tag cannot slip through, drop control
    characters and any stray angle bracket, and tidy the spaces. Line breaks inside a paragraph are kept, runs of blank lines are not."""
    text = str(value or '').replace(_GAP, '')
    for _ in range(2):   # decode first so "&lt;script&gt;" is seen as a script block; the second pass catches doubly escaped text
        text = _SCRIPT_BLOCK.sub(_GAP, html.unescape(text))
        text = _TAG.sub(_GAP, text)
    text = _CONTROL.sub('', text).replace('<', _GAP).replace('>', _GAP)
    text = re.sub(rf'\s*{_GAP}+\s*(?=[,.;:!?)\]])', '', text)   # "<b>wallet</b>, black" must not become "wallet , black"
    text = re.sub(rf'{_GAP}+', ' ', text)
    text = re.sub(r'[ \t\xa0]+', ' ', text.replace('\r', ''))
    text = re.sub(r' ?\n ?', '\n', text)
    return re.sub(r'\n{3,}', '\n\n', text).strip()


def _words(text: str):
    return re.findall(r"[^\W\d_]+", text.lower(), re.U)


def gibberish_reason(text: str) -> Optional[str]:
    """Why this looks like keyboard mash or spam, or None. Checks patterns only, never word lists."""
    lowered = text.lower()
    compact = re.sub(r'[^\w]+', '', lowered, flags=re.U)
    if re.search(r'([^\W\d_])\1{4,}', compact, re.U) or re.search(r'(\d)\1{7,}', compact):
        return 'repeated'
    if re.search(r'([^\W\d_]{2,3})\1{3,}', compact, re.U):
        return 'repeated'
    words = _words(lowered)
    for word in words:
        if len(word) >= 5 and any(chunk in word for chunk in _MASH):
            return 'mash'
        if len(word) >= 6 and not (set(word) & _VOWELS):
            return 'no_vowels'
        if re.search(r'[^aeiouy\W\d_]{6,}', word, re.U):
            return 'consonants'
    for index in range(len(words) - 3):
        if len(set(words[index:index + 4])) == 1:
            return 'repeated_word'
    letters = re.sub(r'[\W\d_]+', '', lowered, flags=re.U)
    if len(compact) >= 10 and len(set(compact)) <= 3:
        return 'repeated'
    if len(letters) >= 8 and len(set(letters)) <= 2:
        return 'repeated'
    return None


GIBBERISH_MESSAGE = 'This looks like random typing. Please rewrite the {noun} in your own words.'
NAME_GIBBERISH_MESSAGE = 'This does not look like a real {noun}. Please check the spelling.'


def text_problem(value: Any, kind: str, label: str = '', required: bool = True) -> str:
    """The message for a text that is not acceptable, or '' when it is fine. `label` names the field in the message ("description")."""
    rule = RULES[kind]
    noun = label or rule['noun']
    text = strip_markup(value)
    if not text:
        return f'Enter the {noun}.' if required else ''
    if kind == 'name':
        if not _NAME_ALLOWED.match(text):
            return f'Use letters only in your {noun} (spaces, hyphens and apostrophes are fine).'
    if len(text) < rule['min']:
        return f'The {noun} is too short. Write at least {rule["min"]} characters.'
    if len(text) > rule['max']:
        return f'The {noun} is too long. Keep it to {rule["max"]} characters or less.'
    letters = re.sub(r'[\W\d_]+', '', text, flags=re.U)
    if kind in ('description', 'reason', 'comment') and len(letters) < max(2, int(len(re.sub(r'\s+', '', text)) * 0.5)):
        return f'The {noun} needs real words, not just numbers and symbols.'
    if kind in ('title', 'place', 'marks') and len(letters) < 2:
        return f'The {noun} needs real words, not just numbers and symbols.'
    if gibberish_reason(text):
        return NAME_GIBBERISH_MESSAGE.format(noun=noun) if kind == 'name' else GIBBERISH_MESSAGE.format(noun=noun)
    return ''


def clean_field(value: Any, kind: str, field: str, label: str = '', required: bool = True) -> str:
    """The text ready to store: markup stripped and every rule applied. Raises TextRejected with a message for the person."""
    problem = text_problem(value, kind, label, required)
    if problem:
        raise TextRejected(problem, field)
    text = strip_markup(value)
    if text and find_profanity(text):
        raise TextRejected(PROFANITY_MESSAGE, field, 'profanity')
    return text
