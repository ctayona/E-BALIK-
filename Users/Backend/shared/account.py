"""Account helpers shared by the Home (sign-in/registration) and Profile pages."""
import re


def _ensure_email_normalized(email: str) -> str:
    return (email or '').strip().lower()


def _infer_user_role_and_campus(email: str, campus_id: str | None = None):
    normalized_email = _ensure_email_normalized(email)
    if not normalized_email:
        return 'Others', (campus_id or '').strip() or 'OTH001'

    student_match = re.match(r'^.+\.(k\d+|a\d+)@umak\.edu\.ph$', normalized_email, re.IGNORECASE)
    if student_match:
        student_value = student_match.group(1)
        student_id = f"{student_value[0].upper()}{student_value[1:]}"
        return 'Student', student_id

    if normalized_email.endswith('@umak.edu.ph'):
        return 'Faculty', (campus_id or '').strip() or 'FAC-001'

    return 'Others', (campus_id or '').strip() or 'OTH001'


def _verification_profile_metadata(db, user):
    profile = db._decrypt_profile_sensitive_fields(user) or user
    return {
        'verification_status': profile.get('verification_status') or 'pending',
        'verification_document_name': profile.get('verification_document_name') or '',
        'verification_document_type': profile.get('verification_document_type') or '',
        'verification_uploaded_at': profile.get('verification_uploaded_at') or '',
        'verification_review_note': profile.get('verification_review_note') or '',
    }
