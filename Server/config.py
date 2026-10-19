import os
from datetime import timedelta
from dotenv import load_dotenv

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
BACKEND_ROOT = os.path.dirname(__file__)
# All environment files live in <repo>/Environment_Configs (backend secrets and frontend values kept apart)
ENV_CONFIG_DIR = os.path.join(PROJECT_ROOT, 'Environment_Configs')
BACKEND_ENV_FILE = os.path.join(ENV_CONFIG_DIR, 'backend', '.env')
FRONTEND_ENV_FILE = os.path.join(ENV_CONFIG_DIR, 'frontend', '.env.local')
load_dotenv(BACKEND_ENV_FILE)
load_dotenv(FRONTEND_ENV_FILE)


def _secret(name):
    """An environment value with stray spaces, line breaks and wrapping quotes removed.

    A key pasted into a hosting dashboard often carries a trailing newline or quotes, and SendGrid then answers
    401 Unauthorized although the key itself is valid.
    """
    value = (os.getenv(name) or '').strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
        value = value[1:-1].strip()
    return value or None

class Config:
    """Base configuration"""
    FLASK_ENV = os.getenv('FLASK_ENV', 'development')
    DEBUG = os.getenv('FLASK_DEBUG', False)
    
    # Supabase
    SUPABASE_URL = os.getenv('SUPABASE_URL')
    SUPABASE_KEY = os.getenv('SUPABASE_KEY')
    SUPABASE_SERVICE_KEY = os.getenv('SUPABASE_SERVICE_KEY')
    
    # SendGrid
    SENDGRID_API_KEY = _secret('SENDGRID_API_KEY')
    SENDGRID_FROM_EMAIL = _secret('SENDGRID_FROM_EMAIL')
    # Brevo (free: 300 emails a day, works over HTTPS so it is not blocked on Render's free plan). When BREVO_API_KEY is set it is used
    # instead of SendGrid. BREVO_FROM_EMAIL must be a sender verified in Brevo; it falls back to SENDGRID_FROM_EMAIL.
    BREVO_API_KEY = _secret('BREVO_API_KEY')
    BREVO_FROM_EMAIL = _secret('BREVO_FROM_EMAIL') or _secret('SENDGRID_FROM_EMAIL')
    EMAIL_FROM_NAME = _secret('EMAIL_FROM_NAME') or 'E-Balik Lost & Found'
    
    # Auction winner notice: 'auto' sends when SENDGRID_API_KEY is set (else logs); 'mock' only logs; 'sendgrid' always sends.
    AUCTION_EMAIL_MODE = os.getenv('AUCTION_EMAIL_MODE', 'auto').strip().lower()

    # JWT
    JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY', 'dev-secret-key-change-in-production')
    # Session lifetimes. A token older than this is refused even if its own expiry is later (see JWTService.verify_token),
    # so sessions issued before this limit existed (30 days) stop working too. Staff = admin, super admin and guard.
    SESSION_USER_HOURS = float(os.getenv('SESSION_USER_HOURS', 12))
    SESSION_STAFF_HOURS = float(os.getenv('SESSION_STAFF_HOURS', 8))
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=SESSION_USER_HOURS)
    APP_ENCRYPTION_KEY = os.getenv('APP_ENCRYPTION_KEY')

    # Google OAuth
    GOOGLE_CLIENT_ID = os.getenv('GOOGLE_CLIENT_ID') or os.getenv('VITE_GOOGLE_CLIENT_ID')
    GOOGLE_CLIENT_SECRET = os.getenv('GOOGLE_CLIENT_SECRET') or os.getenv('secret_google')
    
    # OTP
    OTP_EXPIRATION_MINUTES = int(os.getenv('OTP_EXPIRATION_MINUTES', 10))
    
    # CORS
    CORS_ORIGINS = [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:3000",
        "http://localhost:4173",
        "http://localhost:8080",
        "http://localhost:8443",  # Admin dev server (npm run dev:admin)
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:4173",
        "http://127.0.0.1:8080",
        "http://127.0.0.1:8443",
    ]

class DevelopmentConfig(Config):
    """Development configuration"""
    DEBUG = True
    TESTING = False

class ProductionConfig(Config):
    """Production configuration"""
    DEBUG = False
    TESTING = False
    # Comma-separated list of allowed site origins, e.g. https://ebalik.vercel.app (set CORS_ORIGINS on the host)
    CORS_ORIGINS = [origin.strip().rstrip('/') for origin in os.getenv('CORS_ORIGINS', '').split(',') if origin.strip()]

class TestingConfig(Config):
    """Testing configuration"""
    DEBUG = True
    TESTING = True

# Config mapping
config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'testing': TestingConfig,
    'default': DevelopmentConfig
}
