"""The date on a lost or found report: a real calendar day, never in the future, and not implausibly old.

"Today" is the campus day (Manila, UTC+8), not the server's UTC day: a report made at 00:30 in Manila is dated that day.
The browser applies the same rule (`utils/reportDates.ts`), so the date picker never offers a day the server would refuse.
"""
from datetime import date, datetime, timedelta, timezone
from typing import Optional

CAMPUS_TZ = timezone(timedelta(hours=8))
# Older than this is almost always a typing slip (2005 for 2025). The office keeps found items for months, not years.
MAX_AGE_DAYS = 365


def campus_today(now: Optional[datetime] = None) -> date:
    return (now or datetime.now(timezone.utc)).astimezone(CAMPUS_TZ).date()


def date_problem(value: object, label: str, now: Optional[datetime] = None) -> Optional[str]:
    """None when `value` is an acceptable report date (YYYY-MM-DD), otherwise the message to show next to the field."""
    text = str(value or '').strip()
    if not text:
        return f'Enter the {label}.'
    try:
        day = datetime.strptime(text, '%Y-%m-%d').date()
    except ValueError:
        return f'The {label} must be a real date (YYYY-MM-DD).'
    today = campus_today(now)
    if day > today:
        return f'The {label} cannot be in the future. Choose today or an earlier day.'
    if (today - day).days > MAX_AGE_DAYS:
        return f'The {label} cannot be more than a year ago. Check the year, or bring the item to the Lost and Found Office.'
    return None


def check_date(value: object, field: str, label: str, now: Optional[datetime] = None) -> str:
    """The cleaned date, or TextRejected naming the field, so the form shows the message under the date input."""
    from app.utils.text_guard import TextRejected
    problem = date_problem(value, label, now)
    if problem:
        raise TextRejected(problem, field, 'invalid_date')
    return str(value).strip()
