"""Turn the failures in a `python -m unittest` log into GitHub annotations, so the run page shows WHICH test failed and why.

Usage (CI): python scripts/ci_annotate_failures.py path/to/log
Each FAIL or ERROR block becomes one `::error` line with the test name and the last lines of its traceback. Only reads the log.
"""
import re
import sys


def clean(value: str, limit: int) -> str:
    """GitHub workflow commands need these characters escaped; keep it to plain text."""
    return value.replace('%', '%25').replace('\r', ' ').replace('\n', ' ').replace(':', ' ').replace(',', ' ')[:limit]


def main(path: str) -> int:
    text = open(path, encoding='utf-8', errors='replace').read()
    blocks = [b for b in re.split(r'\n={60,}\n', text)[1:] if re.match(r'(FAIL|ERROR): ', b.strip())]
    for block in blocks[:20]:
        lines = [line.rstrip() for line in block.strip().splitlines() if line.strip() and not set(line.strip()) <= {'-'}]
        title = clean(lines[0], 120)
        detail = ' | '.join(line.strip() for line in lines[-7:])
        print(f'::error title={title}::{clean(detail, 1200)}')
    if not blocks:
        tail = ' | '.join(line.strip() for line in text.strip().splitlines()[-8:])
        print(f'::error title=Backend tests did not finish::{clean(tail, 1200)}')
    print(f'{len(blocks)} failing test(s) reported', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))
