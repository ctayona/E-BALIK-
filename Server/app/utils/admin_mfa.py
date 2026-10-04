import base64
import hashlib
import hmac
import io
import re
import secrets
import time

import pyotp
import qrcode


def matched_totp_step(secret: str, code: str):
    if not re.fullmatch(r"\d{6}", code or ""):
        return None
    totp = pyotp.TOTP(secret)
    current_step = int(time.time() // totp.interval)
    for step in (current_step - 1, current_step, current_step + 1):
        if step >= 0 and hmac.compare_digest(totp.at(step * totp.interval), code):
            return step
    return None


def normalize_recovery_code(code: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", code or "").upper()


def hash_recovery_code(code: str) -> str:
    return hashlib.sha256(normalize_recovery_code(code).encode("utf-8")).hexdigest()


def generate_recovery_codes(count: int = 10) -> list[str]:
    codes = []
    for _ in range(count):
        raw = secrets.token_hex(16).upper()
        codes.append("-".join((raw[:8], raw[8:16], raw[16:24], raw[24:])))
    return codes


def qr_data_uri(provisioning_uri: str) -> str:
    image = qrcode.make(provisioning_uri)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"
