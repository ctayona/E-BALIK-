# 🚀 E-BALIK QUICK START GUIDE

## Complete Setup for Lost & Found System
**University of Makati** | **Created**: 2026-08-17

---

## 📋 WHAT WAS BUILT

### ✅ Backend (Python Flask)
- Complete authentication system
- User registration with OTP verification
- Login with JWT tokens
- Password reset with OTP
- SendGrid email integration
- Supabase database connection
- Row-level security enabled
- Error handling & validation

### ✅ Database (Supabase)
- `user_profiles` table with full schema
- `otp_tokens` table for verification
- Future tables for items & claims
- Comprehensive indexing
- Security policies

### ✅ Frontend (React + TypeScript)
- API client for all requests
- useAuth React hook
- OTP modal component
- Authentication utilities
- Local storage management

---

## ⚡ QUICK SETUP (5 minutes)

### Step 1: Database Setup (One-time)
1. Go to https://app.supabase.com
2. Select "E-Balik" project
3. Click **SQL Editor**
4. Create a new query
5. Paste content from `/backend/database_schema.sql`
6. Click **Run**

✅ Done! Tables are created.

For an existing database, do not rerun the full schema. Apply only the incremental migrations that match the features you are deploying:

- `backend/manual_migrations/20260928_claim_identity_and_admin_access.sql` for private claim documents and admin access levels.
- `backend/manual_migrations/20260929_admin_totp_mfa.sql` for optional Admin Authenticator MFA.

Run each migration once in Supabase SQL Editor before deploying the matching backend code. Configure a stable `APP_ENCRYPTION_KEY` in the backend environment before enabling MFA.

### Step 2: Frontend Environment
```bash
# In project root
cp .env.local.example .env.local
```

No changes needed - defaults are correct for development.

### Step 3: Start Backend
```bash
cd backend
venv\Scripts\activate  # Windows
# or: source venv/bin/activate  # Mac/Linux
python run.py
```

✅ Server running at `http://localhost:5000`

### Step 4: Start Frontend
```bash
# In another terminal, from project root
npm run dev
```

✅ Frontend running at `http://localhost:5173`

---

## 🔄 COMPLETE WORKFLOW

### 1. User Registration
```
Frontend                Backend              Database        SendGrid
  │                        │                     │               │
  ├─ Fill form ────────────┤                     │               │
  │                        ├─ Generate OTP ────┤ Store OTP      │
  │                        ├─ Send email ───────────────────────>│
  │ OTP Modal shows        │                     │               │
  ├─ Enter OTP ───────────>│                     │               │
  │                        ├─ Verify OTP ──────>│ Check OTP      │
  │                        ├─ Hash password     │                │
  │                        ├─ Create user ─────>│ Insert user    │
  │ JWT returned           │                     │               │
  ├─ Save token           │                     │               │
  ├─ Redirect to dashboard │                    │               │
```

### 2. User Login
```
Frontend                Backend              Database
  │                        │                     │
  ├─ Enter credentials ───>│                     │
  │                        ├─ Find user ───────>│ Query user
  │                        ├─ Verify password   │
  │ JWT returned           │ Create JWT         │
  ├─ Save token           │                     │
  ├─ Redirect to dashboard │                    │
```

### 3. Password Reset
```
Frontend                Backend              Database        SendGrid
  │                        │                     │               │
  ├─ Forgot password ─────>│                     │               │
  │                        ├─ Generate OTP ────>│ Store OTP      │
  │                        ├─ Send email ───────────────────────>│
  │ OTP Modal shows        │                     │               │
  ├─ Enter OTP & new PW ──>│                     │               │
  │                        ├─ Verify OTP ──────>│ Check OTP      │
  │                        ├─ Hash new password │                │
  │                        ├─ Update user ─────>│ Update password│
  │ Success message        │                     │               │
  ├─ Redirect to login     │                    │               │
```

---

## 🔧 KEY FILES

### Backend
```
backend/
├── run.py                    # Start server here
├── .env                      # Credentials (configured)
├── requirements.txt          # Python packages (installed)
├── database_schema.sql       # SQL schema
├── app/
│   ├── routes/auth.py       # All API endpoints
│   └── utils/
│       ├── auth.py          # Password & JWT
│       ├── email_service.py # SendGrid & OTP
│       └── supabase_db.py   # Database operations
└── BACKEND_SETUP.md         # Detailed backend docs
```

### Frontend
```
src/app/
├── utils/
│   ├── api.ts               # API client
│   └── useAuth.ts           # Auth hook
├── components/
│   └── OTPModal.tsx         # OTP modal
└── pages/
    ├── Login.tsx            # (to integrate)
    └── Register.tsx         # (to integrate)
```

### Documentation
```
├── QUICK_START.md           # This file
├── DATABASE_SCHEMA.txt      # Full schema details
├── FRONTEND_INTEGRATION.md  # Frontend guide
└── backend/BACKEND_SETUP.md # Backend guide
```

---

## 🔐 CREDENTIALS REFERENCE

### Already Configured (.env files)
```
Supabase:
  URL: https://onwlvwqauptstemmvyhz.supabase.co
  Key: sb_publishable_Hsg85D0CSUQvfT3Z_J3crg_4WsyBmmr
  Service Key: [configured in backend/.env]

SendGrid:
  API Key: [configured in backend/.env]
  From Email: ebaliksupport@gmail.com

JWT:
  Secret: [auto-generated, change in production]

API:
  URL: http://localhost:5000
  Frontend: http://localhost:5173
```

⚠️ **Important**: Change JWT_SECRET_KEY before production deployment!

---

## 📡 API ENDPOINTS

All endpoints at `http://localhost:5000/api/auth/`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/register` | Start registration, send OTP |
| POST | `/verify-otp` | Verify OTP, complete registration |
| POST | `/login` | Login user, return JWT |
| POST | `/forgot-password` | Request password reset OTP |
| POST | `/reset-password` | Reset password with OTP |
| GET | `/verify-token` | Check if JWT is valid |

See `backend/BACKEND_SETUP.md` for request/response examples.

---

## 🧪 TESTING

### Test Registration (curl)
```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "fname": "John",
    "lname": "Doe",
    "email": "john@umak.edu.ph",
    "campus_id": "A2023-12345",
    "password": "SecurePass123!"
  }'
```

### Test Login (curl)
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@umak.edu.ph",
    "password": "SecurePass123!"
  }'
```

### Using Postman
1. Create new collection
2. Add requests from `backend/BACKEND_SETUP.md`
3. Test each endpoint
4. Check responses

---

## 📱 REACT COMPONENT INTEGRATION

### Step 1: Import Hook
```typescript
import { useAuth } from '@/app/utils/useAuth';
```

### Step 2: Use in Component
```typescript
function MyAuthComponent() {
  const { user, login, register, isLoading, error } = useAuth();
  
  const handleLogin = async (email, password) => {
    const result = await login(email, password);
    if (result.success) {
      // Redirect to dashboard
    }
  };
  
  return (
    // Your JSX here
  );
}
```

See `FRONTEND_INTEGRATION.md` for complete examples.

---

## ⚠️ TROUBLESHOOTING

### Backend won't start
```bash
# Check if port 5000 is in use
lsof -i :5000  # Mac/Linux
netstat -ano | findstr :5000  # Windows

# Try different port
python run.py  # Then update .env.local: VITE_API_URL=http://localhost:5001
```

### CORS Error
```
Error: Access to XMLHttpRequest blocked by CORS policy

Solution:
- Backend CORS configured for localhost:5173
- If using different port, update backend/config.py CORS_ORIGINS
```

### OTP not received
```
- Check email spam folder
- Verify SENDGRID_API_KEY in backend/.env
- Check email format in registration
```

### JWT Token Issues
```
- Token stored in localStorage as 'ebalik_token'
- Expires after 30 days
- Required for protected endpoints
- Check browser DevTools > Application > Storage
```

---

## 🔄 NEXT STEPS AFTER SETUP

### 1. Integrate with Frontend Components
- [ ] Update Login.tsx with useAuth hook
- [ ] Update Register.tsx with API calls & OTPModal
- [ ] Add error handling & loading states
- [ ] Test complete auth flow

### 2. Build Item Management
- [ ] Create found items page
- [ ] Create missing items page
- [ ] Add image upload
- [ ] Add search functionality

### 3. Add User Dashboard
- [ ] Display user profile
- [ ] Show user's items
- [ ] Track claims

### 4. Production Preparation
- [ ] Change JWT_SECRET_KEY
- [ ] Update API_URL to production
- [ ] Set up HTTPS
- [ ] Configure environment variables
- [ ] Database backups
- [ ] Error logging

---

## 📞 SUPPORT

### Documentation Files
1. `QUICK_START.md` ← You are here
2. `FRONTEND_INTEGRATION.md` - Frontend integration guide
3. `backend/BACKEND_SETUP.md` - Backend & API docs
4. `DATABASE_SCHEMA.txt` - Full database schema

### Common Issues
1. Check the troubleshooting section above
2. Review relevant documentation
3. Check backend console for error logs
4. Verify environment variables

### Getting Help
- Check error messages in browser console
- Check backend terminal for API errors
- Verify database connection in Supabase console
- Check .env files are correct

---

## 📊 PROJECT STRUCTURE

```
EBALIK-PROJECT/
├── src/                          # Frontend React app
│   └── app/
│       ├── utils/
│       │   ├── api.ts           # API client
│       │   └── useAuth.ts       # Auth hook
│       ├── components/
│       │   └── OTPModal.tsx     # OTP modal
│       └── pages/
│           ├── Login.tsx
│           └── Register.tsx
├── backend/                      # Flask backend
│   ├── app/
│   │   ├── routes/auth.py       # API endpoints
│   │   └── utils/
│   │       ├── auth.py
│   │       ├── email_service.py
│   │       └── supabase_db.py
│   ├── run.py                   # Start server
│   ├── .env                     # Config
│   └── requirements.txt
├── DATABASE_SCHEMA.txt          # Schema reference
├── FRONTEND_INTEGRATION.md      # Frontend guide
├── QUICK_START.md              # This file
└── .env.local.example          # Frontend config template
```

---

## ✨ KEY FEATURES READY

✅ Secure password hashing (bcrypt)
✅ Email verification with OTP
✅ JWT authentication
✅ Password reset workflow
✅ SendGrid integration
✅ Supabase database
✅ Row-level security
✅ Error handling
✅ CORS configured
✅ Comprehensive logging

---

## 🎯 SUCCESS CRITERIA

You'll know everything is working when:

1. ✅ Backend starts without errors
2. ✅ Frontend loads and shows "Register/Login"
3. ✅ Can register with email and receive OTP
4. ✅ Can enter OTP and complete registration
5. ✅ Can login with email/password
6. ✅ JWT token saved in localStorage
7. ✅ Can reset password
8. ✅ Redirect to dashboard on login

---

## 🎉 YOU'RE ALL SET!

Everything is configured and ready to use. Start with the **3 steps** in the **QUICK SETUP** section above.

Good luck with E-Balik! 🎓

---

**Version**: 1.0  
**Created**: 2026-08-17  
**System**: E-Balik Lost & Found, University of Makati  
**Status**: ✅ Ready for Development
