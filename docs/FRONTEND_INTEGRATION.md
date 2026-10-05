# E-BALIK FRONTEND INTEGRATION GUIDE

## ✅ Setup Complete

All API integration code is ready. Follow this guide to connect your frontend to the backend.

---

## 📁 New Files Created

### API & Authentication Files
- **`src/app/utils/api.ts`** - API client for all backend requests
- **`src/app/utils/useAuth.ts`** - React hook for authentication management
- **`src/app/components/OTPModal.tsx`** - OTP verification modal component
- **`.env.local.example`** - Frontend environment configuration template

---

## 🚀 QUICK START

### 1. Create Environment File
```bash
# In the project root directory
cp Environment_Configs/frontend/.env.local.example Environment_Configs/frontend/.env.local
```

Edit `Environment_Configs/frontend/.env.local`:
```
VITE_API_URL=http://localhost:5000
VITE_API_TIMEOUT=30000
```

### 2. Start Backend Server
```bash
cd backend
venv\Scripts\activate  # Windows
python run.py
```

### 3. Start Frontend (in another terminal)
```bash
npm run dev
```

---

## 🔌 Integration with React Components

### Using the useAuth Hook

```typescript
import { useAuth } from '@/app/utils/useAuth';

function MyComponent() {
  const { user, isLoading, error, login, logout } = useAuth();
  
  const handleLogin = async (email: string, password: string) => {
    const result = await login(email, password);
    if (result.success) {
      console.log('Logged in:', result.user);
    }
  };
  
  return (
    // Use user, isLoading, error, handleLogin, etc.
  );
}
```

### Available Auth Methods

```typescript
const {
  // State
  user,            // Current user data
  isLoading,       // Request in progress
  error,           // Error message
  isAuthenticated, // Login status
  
  // Methods
  register,        // Start registration
  verifyOtp,       // Verify OTP & complete registration
  login,           // Login user
  logout,          // Logout
  forgotPassword,  // Start password reset
  resetPassword,   // Complete password reset
  
  // Utilities
  clearError,      // Clear error message
} = useAuth();
```

---

## 📝 Component Integration Examples

### Login Component Integration

```typescript
import { useState } from 'react';
import { useAuth } from '@/app/utils/useAuth';
import { Eye, EyeOff } from 'lucide-react';

export default function Login({ onLoginSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const { login, isLoading, error } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await login(email, password);
    
    if (result.success) {
      onLoginSuccess();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full">
      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm">
          {error}
        </div>
      )}
      
      <div>
        <label className="font-semibold text-sm">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full border rounded-lg px-4 py-2"
        />
      </div>

      <div>
        <label className="font-semibold text-sm">Password</label>
        <div className="relative">
          <input
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full border rounded-lg px-4 py-2"
          />
          <button
            type="button"
            onClick={() => setShowPw(!showPw)}
            className="absolute right-3 top-1/2 -translate-y-1/2"
          >
            {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="bg-blue-600 text-white py-2 rounded-lg disabled:bg-gray-400"
      >
        {isLoading ? 'Logging in...' : 'Log In'}
      </button>
    </form>
  );
}
```

### Register Component Integration

```typescript
import { useState } from 'react';
import { useAuth } from '@/app/utils/useAuth';
import OTPModal from '@/app/components/OTPModal';

export default function Register({ onRegisterSuccess }) {
  const [step, setStep] = useState<'form' | 'otp'>('form');
  const [formData, setFormData] = useState({
    fname: '',
    mname: '',
    lname: '',
    email: '',
    campus_id: '',
    password: '',
    confirmPassword: '',
  });
  const [otpCode, setOtpCode] = useState('');
  const { register, verifyOtp, isLoading, error } = useAuth();

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const result = await register({
      fname: formData.fname,
      mname: formData.mname,
      lname: formData.lname,
      email: formData.email,
      campus_id: formData.campus_id,
      password: formData.password,
    });
    
    if (result.success) {
      setStep('otp');
    }
  };

  const handleOtpSubmit = async (otp: string) => {
    const result = await verifyOtp(formData.email, otp);
    
    if (result.success) {
      onRegisterSuccess();
    }
  };

  if (step === 'otp') {
    return (
      <OTPModal
        isOpen={true}
        onClose={() => setStep('form')}
        onSubmit={handleOtpSubmit}
        email={formData.email}
        title="Verify Your Email"
        description="Enter the 6-digit code sent to your email"
        error={error}
        isLoading={isLoading}
      />
    );
  }

  return (
    <form onSubmit={handleRegisterSubmit} className="flex flex-col gap-4 w-full">
      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm">
          {error}
        </div>
      )}
      
      <input
        type="text"
        placeholder="First Name"
        value={formData.fname}
        onChange={(e) => setFormData({ ...formData, fname: e.target.value })}
        required
        className="border rounded-lg px-4 py-2"
      />
      
      {/* ... more fields ... */}

      <button
        type="submit"
        disabled={isLoading}
        className="bg-blue-600 text-white py-2 rounded-lg disabled:bg-gray-400"
      >
        {isLoading ? 'Creating Account...' : 'Register'}
      </button>
    </form>
  );
}
```

---

## 🔐 Authentication Flow

### Registration Flow
```
1. User fills registration form
   └─ Calls: register(userData)
   
2. Backend sends OTP email
   └─ Response: "Check your email"
   
3. OTP Modal shows
   └─ User enters code
   
4. User submits OTP
   └─ Calls: verifyOtp(email, otp_code)
   
5. Backend verifies OTP & creates user
   └─ JWT token returned
   
6. Token saved to localStorage
   └─ User logged in automatically
   
7. Redirect to dashboard
   └─ Success!
```

### Login Flow
```
1. User enters email & password
   └─ Calls: login(email, password)
   
2. Backend validates credentials
   └─ JWT token returned
   
3. Token saved to localStorage
   └─ User authenticated
   
4. Redirect to dashboard
   └─ Success!
```

### Password Reset Flow
```
1. User clicks "Forgot Password"
   └─ Calls: forgotPassword(email)
   
2. Backend sends OTP email
   └─ Response: "Check your email"
   
3. OTP Modal shows
   └─ User enters code & new password
   
4. User submits
   └─ Calls: resetPassword(otp_code, new_password)
   
5. Backend updates password
   └─ Success: User can login with new password
```

---

## 💾 Local Storage Management

The authentication system uses localStorage for:

```javascript
// Set token after login
localStorage.setItem('ebalik_token', jwt_token)

// Get token for authenticated requests
const token = localStorage.getItem('ebalik_token')

// Set user data
localStorage.setItem('ebalik_user', JSON.stringify(userData))

// Get user data
const user = JSON.parse(localStorage.getItem('ebalik_user'))

// Clear all auth data on logout
localStorage.removeItem('ebalik_token')
localStorage.removeItem('ebalik_user')
```

---

## 📡 API Error Handling

All API responses include error information:

```typescript
const result = await login(email, password);

if (!result.success) {
  console.error('Error:', result.error);
  // Handle error
}

// Common errors:
// - "Invalid email or password"
// - "Email already registered"
// - "OTP has expired"
// - "Connection refused"
```

---

## ⚙️ Configuration Options

### Timeout
Change API timeout in `.env.local`:
```
VITE_API_TIMEOUT=30000  # milliseconds
```

### API URL
For production, update `.env.local`:
```
VITE_API_URL=https://api.example.com
```

---

## 🧪 Testing the Integration

### Test Registration
```javascript
// In browser console
const { register } = useAuth();
await register({
  fname: 'John',
  lname: 'Doe',
  email: 'john@umak.edu.ph',
  campus_id: 'A2023-12345',
  password: 'SecurePass123!'
});
```

### Test Login
```javascript
const { login } = useAuth();
await login('john@umak.edu.ph', 'SecurePass123!');
```

### Check Authentication
```javascript
const token = localStorage.getItem('ebalik_token');
console.log('Authenticated:', !!token);
```

---

## 🐛 Troubleshooting

### Issue: "Cannot POST /api/auth/login"
**Solution**: 
- Make sure backend is running on http://localhost:5000
- Check VITE_API_URL in .env.local

### Issue: "CORS error"
**Solution**:
- Backend CORS is configured for http://localhost:5173
- If using different port, update config.py in backend

### Issue: "No authentication token found"
**Solution**:
- Token must be saved after login with `authUtils.setToken()`
- Check browser localStorage for 'ebalik_token'

### Issue: "OTP not received"
**Solution**:
- Check SENDGRID_API_KEY in `Environment_Configs/backend/.env`
- Verify email is correct
- Check spam folder

---

## 📚 File Reference

| File | Purpose |
|------|---------|
| `src/app/utils/api.ts` | HTTP client & API functions |
| `src/app/utils/useAuth.ts` | Authentication React hook |
| `src/app/components/OTPModal.tsx` | OTP input modal |
| `backend/app/routes/auth.py` | Backend authentication endpoints |
| `Environment_Configs/frontend/.env.local` | Frontend configuration |
| `Environment_Configs/backend/.env` | Backend configuration |

---

## ✅ Implementation Checklist

- [ ] Create `.env.local` file
- [ ] Start backend: `python run.py`
- [ ] Import `useAuth` hook in your components
- [ ] Update Login component with API calls
- [ ] Update Register component with API calls
- [ ] Add OTPModal component to Register
- [ ] Test registration flow
- [ ] Test login flow
- [ ] Test password reset flow
- [ ] Deploy backend & update VITE_API_URL

---

## 🎉 You're Ready!

All the backend infrastructure is set up. Now:
1. Connect your components to the useAuth hook
2. Update the Login and Register pages
3. Test the complete auth flow
4. Deploy when ready

For detailed API documentation, see `backend/BACKEND_SETUP.md`

---

**Created**: 2026-08-17  
**Last Updated**: 2026-08-17  
**System**: E-Balik Lost & Found, University of Makati
