"""One clock for people: Philippine Standard Time (UTC+8).

The database stores UTC. Anything a person reads as a date (the analytics charts, the daily summary email, "today") must be
the date in Makati, otherwise a report filed at 7 AM lands on the previous day and a 9 AM summary goes out at 1 AM.
"""
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

PHT = timezone(timedelta(hours=8))


def now_pht() -> datetime:
    return datetime.now(timezone.utc).astimezone(PHT)


def today_pht() -> date:
    return now_pht().date()


def to_pht_date(value: Any) -> Optional[date]:
    """The Makati calendar day of a stored value.

    A plain date ("2026-10-01", a lost date typed by the user) is already a local day and is returned as it is. A timestamp
    ("2026-10-01T18:30:00+00:00") is converted to PHT first, so 18:30 UTC on the 1st is the 2nd in Makati.
    """
    text = str(value or '').strip()
    if not text:
        return None
    if len(text) <= 10:
        try:
            return date.fromisoformat(text)
        except ValueError:
            return None
    try:
        moment = datetime.fromisoformat(text.replace('Z', '+00:00'))
    except ValueError:
        try:
            return date.fromisoformat(text[:10])
        except ValueError:
            return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(PHT).date()
