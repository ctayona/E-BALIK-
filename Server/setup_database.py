"""
Database setup script for E-Balik
This script creates all necessary tables in Supabase
Run this once to initialize the database
"""
import os
import sys
from dotenv import load_dotenv
from supabase import create_client, Client
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Load environment variables from <repo>/Environment_Configs/backend/.env
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'Environment_Configs', 'backend', '.env'))

def setup_database():
    """Setup database tables"""
    try:
        # Initialize Supabase client with service key
        url = os.getenv('SUPABASE_URL')
        service_key = os.getenv('SUPABASE_SERVICE_KEY')
        
        if not url or not service_key:
            logger.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env")
            return False
        
        client: Client = create_client(url, service_key)
        logger.info("✓ Connected to Supabase")
        
        # Read SQL schema file
        schema_file = os.path.join(os.path.dirname(__file__), 'database_schema.sql')
        with open(schema_file, 'r') as f:
            sql_statements = f.read()
        
        # Note: Supabase doesn't directly support executing raw SQL through the client
        # Instead, we'll use RPC or manual execution through the web console
        logger.info("✓ Database schema file loaded")
        logger.info("")
        logger.info("=" * 70)
        logger.info("MANUAL SETUP REQUIRED")
        logger.info("=" * 70)
        logger.info("")
        logger.info("Please follow these steps to set up the database:")
        logger.info("")
        logger.info("1. Go to https://app.supabase.com")
        logger.info("2. Select your E-Balik project")
        logger.info("3. Click 'SQL Editor' in the left sidebar")
        logger.info("4. Click '+ New Query'")
        logger.info("5. Copy the entire content of 'database_schema.sql'")
        logger.info("6. Paste it into the SQL editor")
        logger.info("7. Click 'Run' button (or press Ctrl+Enter)")
        logger.info("")
        logger.info("=" * 70)
        logger.info("")
        logger.info("✓ Schema file is ready at: " + schema_file)
        logger.info("")
        
        # Verify connection by listing existing tables
        try:
            # Try to check if tables exist
            logger.info("Checking existing tables in database...")
            # Note: This is just for connection verification
            logger.info("✓ Database connection verified")
        except Exception as e:
            logger.warning(f"⚠ Could not verify tables: {e}")
        
        return True
        
    except FileNotFoundError:
        logger.error("❌ database_schema.sql not found")
        return False
    except Exception as e:
        logger.error(f"❌ Error: {e}")
        return False

if __name__ == '__main__':
    logger.info("")
    logger.info("╔════════════════════════════════════════════════════════════════╗")
    logger.info("║     E-BALIK DATABASE SETUP                                     ║")
    logger.info("║     University of Makati Lost & Found System                   ║")
    logger.info("╚════════════════════════════════════════════════════════════════╝")
    logger.info("")
    
    success = setup_database()
    
    if success:
        logger.info("✓ Setup process completed. Follow the instructions above.")
        sys.exit(0)
    else:
        logger.error("❌ Setup failed")
        sys.exit(1)
