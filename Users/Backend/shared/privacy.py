"""Data Privacy Act (RA 10173) consent, required by the report, claim and verification forms."""
from typing import Any, Dict

DPA_NOTICE_VERSION = '2026-10'
DPA_REQUIRED_MESSAGE = 'You must agree to the Data Privacy Notice (Data Privacy Act of 2012) before submitting.'


def dpa_consent_given(source: Any) -> bool:
    return str(source.get('dpa_consent') or '').strip().lower() in ('1', 'true', 'yes', 'on')


def consent_metadata() -> Dict[str, Any]:
    """Stored with the activity-log entry, so the consent is on record without a schema change."""
    return {'dpa_consent': True, 'dpa_notice_version': DPA_NOTICE_VERSION}
