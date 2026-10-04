#!/usr/bin/env python3
"""
AES-256-GCM Encryption/Decryption Test
Uses your app's CryptoService to test encrypt and decrypt
"""
import sys
import os

# Add backend to path
backend_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_path)

# Load environment variables
from dotenv import load_dotenv
load_dotenv(os.path.join(backend_path, '.env'))

# Import CryptoService
from app.utils.crypto_service import CryptoService

print("=" * 70)
print("AES-256-GCM Encryption/Decryption Test")
print("=" * 70)

# Test 1: Encrypt and Decrypt
print("\n1. Testing Encryption & Decryption:")
test_data = "https://example.com/image.jpg"
print(f"   Original: {test_data}")

encrypted = CryptoService.encrypt(test_data)
print(f"   Encrypted: {encrypted}")

decrypted = CryptoService.decrypt(encrypted)
print(f"   Decrypted: {decrypted}")
print(f"   ✓ Match: {test_data == decrypted}")

# Test 2: Try to decrypt the problematic string
print("\n2. Testing the provided encrypted string:")
encrypted_b64 = "94lUdJ8FomvDUbdkM+clGGw7QyHSY2EnAXF+LgvzYtD"
print(f"   Encrypted: {encrypted_b64}")

decrypted = CryptoService.decrypt(encrypted_b64)
if decrypted:
    print(f"   Decrypted: {decrypted}")
else:
    print(f"   ✗ Failed: String is corrupted, incomplete, or wrong key")

# Test 3: Show how to use it
print("\n3. How to decrypt a value from your database:")
print("""
   from app.utils.crypto_service import CryptoService
   
   # Encrypted value from database
   encrypted_value = "YOUR_ENCRYPTED_STRING"
   
   # Decrypt it
   plaintext = CryptoService.decrypt(encrypted_value)
   print(plaintext)  # Result or None if invalid
""")

print("\n" + "=" * 70)
