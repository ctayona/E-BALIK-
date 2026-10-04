"""
E-Balik Backend Application Entry Point
"""
import os
import sys
from app import create_app

# Create Flask app
app = create_app()

if __name__ == '__main__':
    port = int(os.getenv('FLASK_PORT', 5000))
    debug = os.getenv('FLASK_DEBUG', False)
    
    print(f"""
    E-BALIK LOST & FOUND SYSTEM BACKEND
    University of Makati
    -------------------------------
    Starting server...
    Environment: {os.getenv('FLASK_ENV', 'development')}
    Debug Mode: {debug}
    Server: http://localhost:{port}
    API Docs: http://localhost:{port}/api/docs
    """)
    
    app.run(
        host='0.0.0.0',
        port=port,
        debug=debug
    )
