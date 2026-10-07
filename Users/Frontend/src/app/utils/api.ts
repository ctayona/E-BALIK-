/**
 * API Client for E-Balik Backend
 * Handles all HTTP requests to the backend server
 */

import { emitSystemEvent, type SystemCode } from './system';
import { markActive } from './sessionGuard';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const API_TIMEOUT = import.meta.env.VITE_API_TIMEOUT || 30000;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: unknown;
  headers?: Record<string, string>;
  requiresAuth?: boolean;
}

interface ApiResponse<T = unknown> {
  data?: T;
  error?: string;
  message?: string;
  status: number;
  /** The server's machine-readable reason (report_limit, duplicate_report, dpa_required...) when it sent one. */
  errorCode?: string;
  /** Set when the server blocked the request for a system reason (maintenance, suspension, revoked session, unverified account). */
  code?: SystemCode;
}

/**
 * Short-lived read cache: identical concurrent GETs share one request, and repeat reads within
 * GET_CACHE_TTL_MS reuse the result (e.g. Dashboard → Browse → Dashboard). Any mutation clears it so
 * users always see their own changes. Auth and notification reads are never cached.
 */
const GET_CACHE_TTL_MS = 15_000;
const UNCACHED_PREFIXES = ['/api/auth', '/api/notifications'];
const getCache = new Map<string, { at: number; promise: Promise<ApiResponse<unknown>> }>();

export function invalidateApiCache() {
  getCache.clear();
}

async function apiCall<T = unknown>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<ApiResponse<T>> {
  const method = options.method ?? 'GET';
  if (method !== 'GET') {
    try {
      return await rawApiCall<T>(endpoint, options);
    } finally {
      getCache.clear();
    }
  }
  if (UNCACHED_PREFIXES.some((prefix) => endpoint.startsWith(prefix))) return rawApiCall<T>(endpoint, options);

  const token = options.requiresAuth ? localStorage.getItem('ebalik_token') ?? '' : '';
  const key = `${token}|${endpoint}`;
  const cached = getCache.get(key);
  if (cached && Date.now() - cached.at < GET_CACHE_TTL_MS) return cached.promise as Promise<ApiResponse<T>>;

  const promise = rawApiCall<T>(endpoint, options);
  getCache.set(key, { at: Date.now(), promise: promise as Promise<ApiResponse<unknown>> });
  void promise.then((result) => { if (result.error) getCache.delete(key); });
  return promise;
}

/**
 * Make HTTP request to API
 */
async function rawApiCall<T = unknown>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<ApiResponse<T>> {
  const {
    method = 'GET',
    body,
    headers = {},
    requiresAuth = false,
  } = options;

  const url = `${API_URL}${endpoint}`;
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), API_TIMEOUT);

  try {
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
    const fetchHeaders: Record<string, string> = { ...headers };
    if (!isFormData) fetchHeaders['Content-Type'] = 'application/json';

    // Add JWT token if required
    if (requiresAuth) {
      const token = localStorage.getItem('ebalik_token');
      if (!token) {
        return {
          error: 'No authentication token found',
          status: 401,
        };
      }
      fetchHeaders['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      method,
      headers: fetchHeaders,
      body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
      signal: abortController.signal,
    });

    const data = await response.json();

    clearTimeout(timeoutId);

    if (!response.ok) {
      const code: SystemCode | undefined = data.verification_required ? 'verification_required'
        : data.maintenance ? 'maintenance'
        : data.suspended ? 'suspended'
        : data.session_revoked ? 'session_revoked'
        : undefined;
      // Sign-in attempts get their message inline; everything else is handled once by the app shell.
      if (code && (requiresAuth || code === 'maintenance')) emitSystemEvent({ code, message: data.error, until: data.suspended_until });
      return {
        error: data.error || `Request failed with status ${response.status}`,
        message: data.message,
        status: response.status,
        code,
        errorCode: typeof data.code === 'string' ? data.code : undefined,
      };
    }

    return {
      data,
      status: response.status,
    };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return {
          error: 'Request timeout',
          status: 408,
        };
      }
      return {
        error: error.message,
        status: 0,
      };
    }

    return {
      error: 'Unknown error occurred',
      status: 0,
    };
  }
}

/**
 * Authentication API calls
 */
export const authApi = {
  /**
   * Register new user and send OTP
   */
  async register(data: {
    fname: string;
    mname?: string;
    lname: string;
    email: string;
    campus_id: string;
    password: string;
  }) {
    return apiCall('/api/auth/register', {
      method: 'POST',
      body: data,
    });
  },

  /**
   * Verify OTP and complete registration
   */
  async verifyOtp(data: {
    email: string;
    otp_code: string;
    fname: string;
    mname?: string;
    lname: string;
    campus_id: string;
    password: string;
  }) {
    return apiCall('/api/auth/verify-otp', {
      method: 'POST',
      body: data,
    });
  },

  /**
   * Login user
   */
  async login(email: string, password: string) {
    return apiCall('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
  },

  async verifyAdminMfa(challenge_token: string, code: string) {
    return apiCall('/api/auth/admin-mfa/verify', {
      method: 'POST',
      body: { challenge_token, code },
    });
  },

  /**
   * Login or register with Google ID token
   */
  async googleLogin(credential: string, purpose: 'login' | 'register' = 'login') {
    return apiCall('/api/auth/google-login', {
      method: 'POST',
      body: { credential, purpose },
    });
  },

  /**
   * Request password reset OTP
   */
  async forgotPassword(email: string) {
    return apiCall('/api/auth/forgot-password', {
      method: 'POST',
      body: { email },
    });
  },

  /**
   * Reset password with OTP
   */
  async resetPassword(data: {
    email: string;
    otp_code: string;
    new_password: string;
  }) {
    return apiCall('/api/auth/reset-password', {
      method: 'POST',
      body: data,
    });
  },

  /**
   * Update current user profile
   */
  async getProfile() {
    return apiCall('/api/auth/profile', {
      method: 'GET',
      requiresAuth: true,
    });
  },

  async updateProfile(data: {
    fname: string;
    mname?: string;
    lname: string;
    email: string;
    campus_id?: string;
    user_role?: string;
  }) {
    return apiCall('/api/auth/profile', {
      method: 'PUT',
      body: data,
      requiresAuth: true,
    });
  },

  async uploadVerificationDocument(data: {
    document: File;
    document_type?: string;
    dpa_consent: boolean;
  }) {
    const formData = new FormData();
    formData.append('document', data.document);
    if (data.document_type) formData.append('document_type', data.document_type);
    formData.append('dpa_consent', String(data.dpa_consent));
    return apiCall('/api/auth/profile/document-upload', {
      method: 'POST',
      body: formData,
      requiresAuth: true,
    });
  },

  /**
   * Verify JWT token
   */
  async verifyToken() {
    return apiCall('/api/auth/verify-token', {
      method: 'GET',
      requiresAuth: true,
    });
  },
};

export const foundItemsApi = {
  async create(data: {
    item_name: string;
    category: string;
    description: string;
    location: string;
    found_date: string;
    image?: File;
    turnover_location: string;
    guard_name_or_id: string;
    handover_guard_id?: string;
    dpa_consent: boolean;
  }) {
    const formData = new FormData();
    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) formData.append(key, value instanceof File ? value : String(value));
    });
    return apiCall('/api/found-items', {
      method: 'POST',
      body: formData,
      requiresAuth: true,
    });
  },
  async list() {
    return apiCall('/api/found-items', { requiresAuth: true });
  },
  /** The guards a finder can hand an item to (name only). */
  async guards() {
    return apiCall('/api/found-items/guards', { requiresAuth: true });
  },
  async publicList() {
    return apiCall('/api/found-items/public');
  },
  async search(params: Record<string, string>) {
    const query = new URLSearchParams(params);
    return apiCall(`/api/found-items/search?${query.toString()}`, { requiresAuth: true });
  },
  async matches() {
    return apiCall('/api/found-items/matches', { requiresAuth: true });
  },
  async update(id: string, data: Record<string, string>) {
    return apiCall(`/api/found-items/${encodeURIComponent(id)}`, { method: 'PUT', body: data, requiresAuth: true });
  },
  async remove(id: string) {
    return apiCall(`/api/found-items/${encodeURIComponent(id)}`, { method: 'DELETE', requiresAuth: true });
  },
};

export const missingItemsApi = {
  async create(data: {
    item_name: string;
    category: string;
    description: string;
    distinctive_marks: string;
    last_location: string;
    last_seen_date: string;
    authorized: boolean;
    dpa_consent: boolean;
    image?: File;
  }) {
    const formData = new FormData();
    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) formData.append(key, value instanceof File ? value : String(value));
    });
    return apiCall('/api/missing-items', {
      method: 'POST',
      body: formData,
      requiresAuth: true,
    });
  },
  async list() {
    return apiCall('/api/missing-items', { requiresAuth: true });
  },
  async matches() {
    return apiCall('/api/missing-items/matches', { requiresAuth: true });
  },
  async publicList() {
    return apiCall('/api/missing-items/public', { requiresAuth: true });
  },
  async update(id: string, data: Record<string, string>) {
    return apiCall(`/api/missing-items/${encodeURIComponent(id)}`, { method: 'PUT', body: data, requiresAuth: true });
  },
  async remove(id: string) {
    return apiCall(`/api/missing-items/${encodeURIComponent(id)}`, { method: 'DELETE', requiresAuth: true });
  },
};

export const claimsApi = {
  async list() {
    return apiCall('/api/claims', { requiresAuth: true });
  },
  async create(data: {
    fpost_id: string;
    claim_reason: string;
    proof_image: File;
    identity_document: File;
    identity_document_type: string;
    dpa_consent: boolean;
    missing_report_id?: string;
  }) {
    const formData = new FormData();
    formData.append('dpa_consent', String(data.dpa_consent));
    formData.append('fpost_id', data.fpost_id);
    if (data.missing_report_id) formData.append('missing_report_id', data.missing_report_id);
    formData.append('claim_reason', data.claim_reason);
    formData.append('proof_image', data.proof_image);
    formData.append('identity_document', data.identity_document);
    formData.append('identity_document_type', data.identity_document_type);
    return apiCall('/api/claims', { method: 'POST', body: formData, requiresAuth: true });
  },
  async cancel(claimId: string) {
    return apiCall(`/api/claims/${encodeURIComponent(claimId)}`, { method: 'DELETE', requiresAuth: true });
  },
};

/**
 * Utility functions
 */
export interface PublicBoard {
  missing: { mpost_id: string; item_name: string; category?: string; last_location?: string; last_seen_date?: string; image_url?: string; created_at?: string }[];
  found: { fpost_id: string; item_name: string; category?: string; location?: string; found_date?: string; image_url?: string; created_at?: string }[];
  counts: { missing: number; found: number };
}

export const publicApi = {
  /** Newest missing reports and found items for the signed-out landing page. */
  async board() {
    return apiCall<PublicBoard>('/api/public/board');
  },
};

export const authUtils = {
  /**
   * Save JWT token to localStorage
   */
  setToken(token: string): void {
    localStorage.setItem('ebalik_token', token);
    markActive();  // a new sign-in starts its idle clock now
  },

  /**
   * Get JWT token from localStorage
   */
  getToken(): string | null {
    return localStorage.getItem('ebalik_token');
  },

  /**
   * Remove JWT token
   */
  clearToken(): void {
    localStorage.removeItem('ebalik_token');
    invalidateApiCache();
  },

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return !!this.getToken();
  },

  /**
   * Save user data to localStorage
   */
  setUserData(userData: Record<string, unknown>): void {
    localStorage.setItem('ebalik_user', JSON.stringify(userData));
    window.dispatchEvent(new Event('ebalik:user-updated'));
  },

  /**
   * Get user data from localStorage
   */
  getUserData() {
    const data = localStorage.getItem('ebalik_user');
    return data ? JSON.parse(data) : null;
  },

  /**
   * Clear all auth data
   */
  clearAuthData(): void {
    this.clearToken();
    localStorage.removeItem('ebalik_user');
  },
};

/**
 * Notifications API
 */
export const notificationsAPI = {
  async getNotifications(limit: number = 50) {
    return apiCall(`/api/notifications?limit=${limit}`, { requiresAuth: true });
  },

  async markAsRead(notificationId: string) {
    return apiCall(`/api/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'PATCH', requiresAuth: true });
  },

  async getUnreadCount() {
    return apiCall('/api/notifications/count/unread', { requiresAuth: true });
  },
};

export default apiCall;
