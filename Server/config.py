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

class Config:
    """Base configuration"""
    FLASK_ENV = os.getenv('FLASK_ENV', 'development')
    DEBUG = os.getenv('FLASK_DEBUG', False)
    
    # Supabase
    SUPABASE_URL = os.getenv('SUPABASE_URL')
    SUPABASE_KEY = os.getenv('SUPABASE_KEY')
    SUPABASE_SERVICE_KEY = os.getenv('SUPABASE_SERVICE_KEY')
    
    # SendGrid
    SENDGRID_API_KEY = os.getenv('SENDGRID_API_KEY')
    SENDGRID_FROM_EMAIL = os.getenv('SENDGRID_FROM_EMAIL')
    
    # JWT
    JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY', 'dev-secret-key-change-in-production')
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(days=30)
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
    CORS_ORIGINS = [
        "https://yourdomain.com",  # Update with your production domain
    ]

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
