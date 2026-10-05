"""
Flask Application Factory
"""
from flask import Flask
from flask_cors import CORS
from config import config
import logging
import os
import sys

# Page modules live in <repo>/Users/Backend and <repo>/Admin/Backend; make the repo root importable
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def create_app(config_name: str = None):
    """
    Application factory
    
    Args:
        config_name: Configuration name ('development', 'production', 'testing')
    """
    # Determine config
    if config_name is None:
        config_name = os.getenv('FLASK_ENV', 'development')
    
    app_config = config.get(config_name, config['development'])
    
    # Create Flask app
    app = Flask(__name__)
    app.config.from_object(app_config)
    
    # Configure CORS
    CORS(app, resources={
        r"/api/*": {
            "origins": app_config.CORS_ORIGINS,
            "methods": ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
            "allow_headers": ["Content-Type", "Authorization"],
            "supports_credentials": True
        }
    })
    
    logger.info(f"✓ Flask app created with config: {config_name}")
    
    # Initialize database
    try:
        from app.utils.supabase_db import get_db
        db = get_db(
            url=app_config.SUPABASE_URL,
            service_key=app_config.SUPABASE_SERVICE_KEY
        )
        app.db = db
        
        # Test database connection
        if db.health_check():
            logger.info("✓ Database connection established")
        else:
            logger.warning("⚠ Database health check failed")
    except Exception as e:
        logger.error(f"✗ Failed to initialize database: {e}")
    
    # Maintenance lock, revoked sessions, suspension and the verification gate run before every API route
    from app.utils.system_control import enforce_request
    app.before_request(enforce_request)

    # Register routes/blueprints
    from app.blueprints import register_blueprints
    register_blueprints(app)
    logger.info("✓ Routes registered")
    
    # Register error handlers
    register_error_handlers(app)
    
    return app

def register_error_handlers(app: Flask):
    """Register error handlers"""
    
    @app.errorhandler(400)
    def bad_request(error):
        return {'error': 'Bad request', 'message': str(error)}, 400
    
    @app.errorhandler(401)
    def unauthorized(error):
        return {'error': 'Unauthorized', 'message': 'Authentication required'}, 401
    
    @app.errorhandler(403)
    def forbidden(error):
        return {'error': 'Forbidden', 'message': 'Access denied'}, 403
    
    @app.errorhandler(404)
    def not_found(error):
        return {'error': 'Not found', 'message': 'Resource not found'}, 404
    
    @app.errorhandler(500)
    def internal_error(error):
        logger.error(f"Internal server error: {error}")
        return {'error': 'Internal server error', 'message': 'An unexpected error occurred'}, 500
