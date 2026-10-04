"""Request helpers shared by the report pages."""
from flask import request
from app.utils import JWTService


def _public_url(value):
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return value.get('publicUrl') or value.get('publicURL') or value.get('url')
    return None


def _authenticated_account_id():
    auth_header = request.headers.get('Authorization', '')
    token = JWTService.extract_token_from_header(auth_header)
    payload = JWTService.verify_token(token)
    account_id = payload.get('account_id')
    if not account_id:
        raise ValueError('Token does not contain an account id')
    return account_id
