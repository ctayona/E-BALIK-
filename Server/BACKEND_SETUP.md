# E-BALIK BACKEND SETUP GUIDE

## ✅ Setup Completed
All backend infrastructure is ready to use. Follow this guide to get started.

---

## 🚀 PHASE 1: DATABASE SETUP (Manual - Do This First!)

### Step 1: Create Tables in Supabase
1. Go to https://app.supabase.com and login
2. Select your "E-Balik" project
3. Click **"SQL Editor"** in the left sidebar
4. Click **"+ New Query"** button
5. Copy the entire SQL from [database_schema.sql](./database_schema.sql)
6. Paste it into the editor
7. Click **"Run"** (Ctrl+Enter)

✅ Tables created:
- `user_profiles` - User account information
- `otp_tokens` - OTP codes for verification
- `found_items` - Found items (future)
- `missing_items` - Missing items (future)
- `claims` - Item claims (future)

---

## 🔧 PHASE 2: BACKEND STARTUP

### Prerequisites
- Python 3.10+ (you have 3.13.14) ✅
- Virtual environment created ✅
- All dependencies installed ✅

### Start the Backend Server

**Windows:**
```bash
cd backend
venv\Scripts\activate
python run.py
```

**Mac/Linux:**
```bash
cd backend
source venv/bin/activate
python run.py
```

### Expected Output:
```
╔═══════════════════════════════════════════════════════════════╗
║           E-BALIK LOST & FOUND SYSTEM BACKEND                 ║
║           University of Makati                                ║
╠═══════════════════════════════════════════════════════════════╣
║  Starting server...                                           ║
║  Environment: development                                    ║
║  Debug Mode: True                                            ║
║  Server: http://localhost:5000                                ║
╚═══════════════════════════════════════════════════════════════╝
```

✅ Server running at: `http://localhost:5000`

---

## 📡 API ENDPOINTS

### Authentication Endpoints

#### 1. Register User
**POST** `/api/auth/register`

Request:
```json
{
  "fname": "John",
  "mname": "Michael",
  "lname": "Doe",
  "email": "john.doe@umak.edu.ph",
  "campus_id": "A2023-12345",
  "password": "SecurePass123!"
}
```

Response:
```json
{
  "message": "Registration initiated. Please check your email for verification code.",
  "email": "john.doe@umak.edu.ph",
  "step": "otp_verification"
}
```

---

#### 2. Verify OTP & Complete Registration
**POST** `/api/auth/verify-otp`

Request:
```json
{
  "email": "john.doe@umak.edu.ph",
  "otp_code": "123456",
  "fname": "John",
  "mname": "Michael",
  "lname": "Doe",
  "campus_id": "A2023-12345",
  "password": "SecurePass123!"
}
```

Response:
```json
{
  "message": "Registration successful",
  "account_id": "uuid-here",
  "email": "john.doe@umak.edu.ph",
  "token": "jwt-token-here"
}
```

---

#### 3. Login
**POST** `/api/auth/login`

Request:
```json
{
  "email": "john.doe@umak.edu.ph",
  "password": "SecurePass123!"
}
```

Response:
```json
{
  "message": "Login successful",
  "account_id": "uuid-here",
  "email": "john.doe@umak.edu.ph",
  "fname": "John",
  "lname": "Doe",
  "token": "jwt-token-here"
}
```

---

#### 4. Forgot Password
**POST** `/api/auth/forgot-password`

Request:
```json
{
  "email": "john.doe@umak.edu.ph"
}
```

Response:
```json
{
  "message": "If the email exists, a password reset link has been sent"
}
```

---

#### 5. Reset Password
**POST** `/api/auth/reset-password`

Request:
```json
{
  "email": "john.doe@umak.edu.ph",
  "otp_code": "123456",
  "new_password": "NewSecurePass123!"
}
```

Response:
```json
{
  "message": "Password reset successful"
}
```

---

#### 6. Verify Token
**GET** `/api/auth/verify-token`

Headers:
```
Authorization: Bearer <jwt-token>
```

Response:
```json
{
  "message": "Token is valid",
  "account_id": "uuid-here",
  "email": "john.doe@umak.edu.ph"
}
```

---

## 🔐 AUTHENTICATION

### Using JWT Token

All authenticated requests require:
```
Authorization: Bearer <jwt-token>
```

### Token Expiration
- Access tokens valid for: **30 days**
- OTP codes valid for: **10 minutes**

---

## 📝 ENVIRONMENT VARIABLES

All configured in `Environment_Configs/backend/.env`:

```
# SUPABASE
SUPABASE_URL=https://onwlvwqauptstemmvyhz.supabase.co
SUPABASE_KEY=sb_publishable_Hsg85D0CSUQvfT3Z_J3crg_4WsyBmmr
SUPABASE_SERVICE_KEY=<service_key>

# SENDGRID
SENDGRID_API_KEY=<sendgrid_api_key>
SENDGRID_FROM_EMAIL=ebaliksupport@gmail.com

# JWT
JWT_SECRET_KEY=your_jwt_secret_key_change_this_in_production

# FLASK
FLASK_ENV=development
FLASK_DEBUG=True

# OTP
OTP_EXPIRATION_MINUTES=10
```

⚠️ **Important**: Change `JWT_SECRET_KEY` in production!

---

## 🔄 PROJECT STRUCTURE

```
backend/
├── app/
│   ├── __init__.py          # Flask app factory
│   ├── routes/
│   │   ├── __init__.py
│   │   └── auth.py          # Authentication routes
│   ├── models/
│   │   └── __init__.py
│   └── utils/
│       ├── __init__.py
│       ├── auth.py          # Password & JWT utilities
│       ├── email_service.py # SendGrid email & OTP
│       └── supabase_db.py   # Database operations
├── run.py                   # Entry point
├── config.py                # Configuration
├── requirements.txt         # Python dependencies
├── .env                     # Environment variables
├── database_schema.sql      # SQL schema
└── setup_database.py        # Setup helper
```

---

## 🧪 TESTING THE API

### Using curl:
```bash
# Register
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "fname": "John",
    "lname": "Doe",
    "email": "john@umak.edu.ph",
    "campus_id": "A2023-12345",
    "password": "SecurePass123!"
  }'

# Login
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@umak.edu.ph",
    "password": "SecurePass123!"
  }'
```

### Using Postman:
1. Import the endpoints from above
2. Set Content-Type to `application/json`
3. Test each endpoint

---

## ⚠️ COMMON ISSUES & SOLUTIONS

### Issue: "Connection refused"
**Solution**: Make sure backend is running (`python run.py`)

### Issue: "OTP not received"
**Solution**: Check SENDGRID_API_KEY is correct in .env

### Issue: "Invalid database connection"
**Solution**: 
1. Verify SUPABASE_URL and SUPABASE_SERVICE_KEY in .env
2. Run `python setup_database.py`
3. Ensure tables exist in Supabase console

### Issue: "CORS error"
**Solution**: Frontend must be at `http://localhost:5173` or add to `CORS_ORIGINS` in config.py

---

## 🔄 NEXT STEPS

1. **✅ Database is ready** - Tables created in Supabase
2. **✅ Backend is ready** - Run `python run.py`
3. **⏭️ Connect Frontend** - Update React app to call these APIs
4. ⏭️ Test complete flow - Register → Verify OTP → Login

---

## 📞 SUPPORT

For issues or questions:
1. Check the logs in console output
2. Review API response messages
3. Verify .env variables are correct
4. Check Supabase console for data

---

**Created**: 2026-08-17  
**Last Updated**: 2026-08-17  
**System**: E-Balik Lost & Found, University of Makati
