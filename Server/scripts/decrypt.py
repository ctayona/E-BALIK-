#!/usr/bin/env python3
import sys
import os

# Add backend to path so we can import app
backend_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_path)

# Load environment variables
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(backend_path), 'Environment_Configs', 'backend', '.env'))

# Now import CryptoService
from app.utils.crypto_service import CryptoService

# Encrypted value you want to decrypt
encrypted_b64 = "M9poa3SxCIgf4ikER57DN/J5fwx/U7XnICtJYK6zSkBTOg=="

# Run decryption
print("Decrypting AES-256-GCM data using CryptoService...")
print(f"Encrypted: {encrypted_b64}\n")

result = CryptoService.decrypt(encrypted_b64)
if result:
    print(f"✓ Decrypted: {result}")
else:
    print(f"✗ Decryption failed (invalid data or wrong key)")
