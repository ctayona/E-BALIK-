"""
Authentication utilities for password hashing and JWT token management
"""
import bcrypt
import jwt
import uuid
from datetime import datetime, timedelta, timezone
from config import Config
import logging

logger = logging.getLogger(__name__)

class PasswordService:
    """Password hashing and verification"""
    
    @staticmethod
    def hash_password(password: str) -> str:
        """Hash password using bcrypt"""
        try:
            salt = bcrypt.gensalt(rounds=12)
            hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
            return hashed.decode('utf-8')
        except Exception as e:
            logger.error(f"Error hashing password: {e}")
            raise

    @staticmethod
    def verify_password(password: str, password_hash: str) -> bool:
        """Verify password against hash"""
        try:
            return bcrypt.checkpw(password.encode('utf-8'), password_hash.encode('utf-8'))
        except Exception as e:
            logger.error(f"Error verifying password: {e}")
            return False


class JWTService:
    """JWT token creation and verification"""
    
    @staticmethod
    def create_access_token(account_id: str, email: str, role: str = None, access_level: str = None, expires_delta: timedelta = None, admin_mfa_verified: bool = False, admin_mfa_generation: int = None) -> str:
        """Create JWT access token"""
        try:
            if expires_delta is None:
                expires_delta = Config.JWT_ACCESS_TOKEN_EXPIRES
            
            expire = datetime.utcnow() + expires_delta
            payload = {
                'account_id': account_id,
                'email': email,
                'exp': expire,
                'iat': datetime.utcnow()
            }
            if role:
                payload['user_role'] = role
            if access_level:
                payload['access_level'] = access_level
            if admin_mfa_verified:
                payload['admin_mfa_verified'] = True
            if admin_mfa_generation is not None:
                payload['admin_mfa_generation'] = int(admin_mfa_generation)
            
            token = jwt.encode(
                payload,
                Config.JWT_SECRET_KEY,
                algorithm='HS256'
            )
            logger.info(f"✓ JWT token created for {email}")
            return token
        except Exception as e:
            logger.error(f"✗ Error creating JWT token: {e}")
            raise

    @staticmethod
    def create_admin_mfa_challenge(account_id: str, challenge_id: str, expires_delta: timedelta = timedelta(minutes=5)) -> str:
        now = datetime.now(timezone.utc)
        payload = {
            'account_id': account_id,
            'purpose': 'admin_mfa',
            'challenge_id': challenge_id,
            'iat': now,
            'exp': now + expires_delta,
        }
        return jwt.encode(payload, Config.JWT_SECRET_KEY, algorithm='HS256')

    @staticmethod
    def verify_token(token: str) -> dict:
        """Verify and decode JWT token"""
        try:
            payload = jwt.decode(
                token,
                Config.JWT_SECRET_KEY,
                algorithms=['HS256']
            )
            if payload.get('purpose') == 'admin_mfa':
                raise ValueError('MFA challenge token is not an access token')
            logger.info(f"✓ JWT token verified for {payload.get('email')}")
            return payload
        except jwt.ExpiredSignatureError:
            logger.warning("JWT token has expired")
            raise ValueError("Token has expired")
        except jwt.InvalidTokenError as e:
            logger.warning(f"Invalid JWT token: {e}")
            raise ValueError("Invalid token")
        except Exception as e:
            logger.error(f"Error verifying JWT token: {e}")
            raise ValueError("Token verification failed")

    @staticmethod
    def verify_admin_mfa_challenge(token: str) -> dict:
        try:
            payload = jwt.decode(token, Config.JWT_SECRET_KEY, algorithms=['HS256'])
            if payload.get('purpose') != 'admin_mfa' or not payload.get('challenge_id') or not payload.get('account_id'):
                raise ValueError('Invalid MFA challenge token')
            return payload
        except jwt.ExpiredSignatureError as error:
            raise ValueError('Authenticator challenge expired') from error
        except jwt.InvalidTokenError as error:
            raise ValueError('Invalid authenticator challenge') from error

    @staticmethod
    def extract_token_from_header(auth_header: str) -> str:
        """Extract token from Authorization header"""
        try:
            if not auth_header:
                raise ValueError("Missing authorization header")
            
            parts = auth_header.split()
            if len(parts) != 2 or parts[0].lower() != 'bearer':
                raise ValueError("Invalid authorization header format")
            
            return parts[1]
        except Exception as e:
            logger.error(f"Error extracting token: {e}")
            raise ValueError("Invalid authorization header")
