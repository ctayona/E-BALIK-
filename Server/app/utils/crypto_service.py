import base64
import hashlib
import logging
import os
from typing import Any, Optional

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

logger = logging.getLogger(__name__)


class CryptoService:
    """Minimal AES-256-GCM helper for selected sensitive fields only."""

    @staticmethod
    def _get_key() -> bytes:
        raw_key = (os.getenv('APP_ENCRYPTION_KEY') or '').strip()

        if not raw_key:
            raw_key = os.getenv('JWT_SECRET_KEY') or 'ebalik-dev-local-fallback-key-32bytes'
            logger.warning(
                'APP_ENCRYPTION_KEY is missing; deriving a local-development AES key from the JWT secret/fallback value.'
            )

        # Support either a raw 32-byte string or a base64-encoded 32-byte key.
        if len(raw_key) == 32:
            return raw_key.encode('utf-8')

        try:
            decoded = base64.b64decode(raw_key, validate=True)
            if len(decoded) == 32:
                return decoded
            raise ValueError('APP_ENCRYPTION_KEY must decode to 32 bytes.')
        except Exception:
            digest = hashlib.sha256(raw_key.encode('utf-8')).digest()
            if len(digest) == 32:
                return digest
            raise ValueError('APP_ENCRYPTION_KEY must be 32 bytes or a valid base64 string.')

    @staticmethod
    def encrypt(value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if value == '':
            return ''

        key = CryptoService._get_key()
        aesgcm = AESGCM(key)
        nonce = os.urandom(12)
        ciphertext_and_tag = aesgcm.encrypt(nonce, value.encode('utf-8'), None)
        payload = nonce + ciphertext_and_tag
        return base64.b64encode(payload).decode('utf-8')

    @staticmethod
    def decrypt(value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if value == '':
            return ''

        try:
            key = CryptoService._get_key()
            raw = base64.b64decode(value, validate=True)
            if len(raw) < 28:
                raise ValueError('Encrypted payload is too short.')

            nonce = raw[:12]
            ciphertext_and_tag = raw[12:]
            plaintext = AESGCM(key).decrypt(nonce, ciphertext_and_tag, None)
            return plaintext.decode('utf-8')
        except Exception:
            return None

    @staticmethod
    def encrypt_if_present(value: Optional[str]) -> Optional[str]:
        return CryptoService.encrypt(value) if value is not None else None

    @staticmethod
    def decrypt_if_present(value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        decrypted = CryptoService.decrypt(value)
        return decrypted if decrypted is not None else value

    @staticmethod
    def redact_if_unavailable(value: Optional[str], fallback: Any = '') -> Any:
        decrypted = CryptoService.decrypt_if_present(value)
        return decrypted if decrypted is not None else fallback
