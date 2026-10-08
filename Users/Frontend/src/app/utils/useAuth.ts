/**
 * useAuth Hook for E-Balik
 * Manages authentication state and provides auth functions
 */

import { useState, useCallback, useEffect } from 'react';
import { authApi, authUtils, foundItemsApi, missingItemsApi } from '@/app/utils/api';
import { claimsApi } from '@/app/utils/api';

interface User {
  account_id: string;
  email: string;
  fname: string;
  mname?: string;
  lname: string;
  campus_id?: string;
  user_role?: string;
  user_category?: string;
  access_level?: "user" | "guard" | "admin" | "super_admin";
  verification_status?: string;
  verification_document_name?: string;
  verification_document_type?: string;
  verification_uploaded_at?: string;
  verification_review_note?: string;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  error: string | null;
  isAuthenticated: boolean;
}

interface RegisterData {
  fname: string;
  mname?: string;
  lname: string;
  email: string;
  campus_id: string;
  password: string;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>(() => {
    const token = authUtils.getToken();
    const userData = authUtils.getUserData();

    return {
      user: token && userData ? userData : null,
      isLoading: false,
      error: null,
      isAuthenticated: !!(token && userData),
    };
  });

  // Every component that calls useAuth() has its own state. When any of them refreshes the profile (for example the
  // Profile page noticing an admin approved the account), the others pick the change up here instead of staying stale.
  useEffect(() => {
    const syncFromStorage = () => {
      const token = authUtils.getToken();
      const stored = authUtils.getUserData();
      if (!token || !stored) return;
      setState((previous) => (JSON.stringify(previous.user) === JSON.stringify(stored) ? previous : { ...previous, user: stored }));
    };
    window.addEventListener('ebalik:user-updated', syncFromStorage);
    return () => window.removeEventListener('ebalik:user-updated', syncFromStorage);
  }, []);

  // Initialize auth state from localStorage
  useEffect(() => {
    const token = authUtils.getToken();
    const userData = authUtils.getUserData();

    if (token && userData) {
      setState({
        user: userData,
        isLoading: false,
        error: null,
        isAuthenticated: true,
      });
    }
  }, []);

  /**
   * Register user - Step 1: Send registration and receive OTP
   */
  const register = useCallback(
    async (data: RegisterData) => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      const response = await authApi.register(data);

      if (response.error) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: response.error,
        }));
        return { success: false, error: response.error };
      }

      // Store email for OTP verification step
      sessionStorage.setItem('ebalik_register_email', data.email);
      sessionStorage.setItem('ebalik_register_data', JSON.stringify(data));

      setState((prev) => ({ ...prev, isLoading: false }));
      return { success: true };
    },
    []
  );

  /**
   * Verify OTP - Step 2: Verify OTP and complete registration
   */
  const verifyOtp = useCallback(
    async (email: string, otp_code: string) => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      // Retrieve stored registration data
      const storedData = sessionStorage.getItem('ebalik_register_data');
      if (!storedData) {
        const error = 'Registration data not found. Please register again.';
        setState((prev) => ({ ...prev, isLoading: false, error }));
        return { success: false, error };
      }

      const registerData = JSON.parse(storedData);
      const response = await authApi.verifyOtp({
        ...registerData,
        email,
        otp_code,
      });

      if (response.error) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: response.error,
        }));
        return { success: false, error: response.error };
      }

      // Registration is complete but the user should remain on the registration page
      // and complete the flow with an explicit success notification instead of
      // automatically signing them in.
      sessionStorage.removeItem('ebalik_register_email');
      sessionStorage.removeItem('ebalik_register_data');

      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: null,
        isAuthenticated: false,
      }));

      return { success: true, user: null };
    },
    []
  );

  /**
   * Login user
   */
  const login = useCallback(async (email: string, password: string) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    const response = await authApi.login(email, password);

    if (response.data?.mfa_required && response.data?.challenge_token) {
      authUtils.clearAuthData();
      localStorage.removeItem('ebalik_admin_token');
      localStorage.removeItem('ebalik_admin_user');
      setState({ user: null, isLoading: false, error: null, isAuthenticated: false });
      return { success: false, mfaRequired: true, challengeToken: response.data.challenge_token };
    }

    if (response.error) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: response.error,
      }));
      return { success: false, error: response.error };
    }

    const user: User = {
      account_id: response.data?.account_id || '',
      email: response.data?.email || '',
      fname: response.data?.fname || '',
      mname: response.data?.mname || '',
      lname: response.data?.lname || '',
      campus_id: response.data?.campus_id || '',
      user_role: response.data?.user_role || response.data?.role || 'Others',
      access_level: response.data?.access_level || 'user',
      verification_status: response.data?.verification_status || 'pending',
      verification_document_name: response.data?.verification_document_name || '',
      verification_document_type: response.data?.verification_document_type || '',
      verification_uploaded_at: response.data?.verification_uploaded_at || '',
      verification_review_note: response.data?.verification_review_note || '',
    };

    authUtils.setToken(response.data?.token || '');
    authUtils.setUserData(user);

    setState({
      user,
      isLoading: false,
      error: null,
      isAuthenticated: true,
    });

    return { success: true, user };
  }, []);

  const googleLogin = useCallback(async (credential: string, purpose: 'login' | 'register' = 'login') => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    const response = await authApi.googleLogin(credential, purpose);

    if (response.data?.mfa_required && response.data?.challenge_token) {
      authUtils.clearAuthData();
      localStorage.removeItem('ebalik_admin_token');
      localStorage.removeItem('ebalik_admin_user');
      setState({ user: null, isLoading: false, error: null, isAuthenticated: false });
      return { success: false, mfaRequired: true, challengeToken: response.data.challenge_token };
    }

    if (response.data && response.data.code && response.data.code !== 'LOGIN_SUCCESS') {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: response.data?.message || response.data?.error || 'Google authentication is unavailable right now.',
      }));
      return {
        success: false,
        code: response.data.code,
        error: response.data.message || response.data.error || 'Google authentication is unavailable right now.',
        google_profile: response.data.google_profile || null,
      };
    }

    if (response.error) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: response.error,
      }));
      return {
        success: false,
        error: response.error,
        google_profile: response.data?.google_profile || null,
      };
    }

    const user: User = {
      account_id: response.data?.account_id || '',
      email: response.data?.email || '',
      fname: response.data?.fname || '',
      mname: response.data?.mname || '',
      lname: response.data?.lname || '',
      campus_id: response.data?.campus_id || '',
      user_role: response.data?.user_role || response.data?.role || 'Others',
      access_level: response.data?.access_level || 'user',
      verification_status: response.data?.verification_status || 'pending',
      verification_document_name: response.data?.verification_document_name || '',
      verification_document_type: response.data?.verification_document_type || '',
      verification_uploaded_at: response.data?.verification_uploaded_at || '',
      verification_review_note: response.data?.verification_review_note || '',
    };

    authUtils.setToken(response.data?.token || '');
    authUtils.setUserData(user);

    setState({
      user,
      isLoading: false,
      error: null,
      isAuthenticated: true,
    });

    return { success: true, user };
  }, []);

  const verifyAdminMfa = useCallback(async (challengeToken: string, code: string) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    const response = await authApi.verifyAdminMfa(challengeToken, code);
    if (response.error) {
      setState((prev) => ({ ...prev, isLoading: false, error: response.error || null }));
      return { success: false, error: response.error };
    }

    const user: User = {
      account_id: response.data?.account_id || '',
      email: response.data?.email || '',
      fname: response.data?.fname || '',
      mname: response.data?.mname || '',
      lname: response.data?.lname || '',
      campus_id: response.data?.campus_id || '',
      user_role: response.data?.user_role || 'Others',
      access_level: response.data?.access_level || 'user',
      verification_status: response.data?.verification_status || 'pending',
    };
    authUtils.setToken(response.data?.token || '');
    authUtils.setUserData(user);
    setState({ user, isLoading: false, error: null, isAuthenticated: true });
    return { success: true, user };
  }, []);

  const createFoundItem = useCallback(async (data: {
    item_name: string;
    category: string;
    description: string;
    location: string;
    found_date: string;
    turnover_location: string;
    guard_name_or_id: string;
    handover_guard_id?: string;
    dpa_consent: boolean;
    image?: File;
  }) => {
    const response = await foundItemsApi.create(data);
    if (response.error) return { success: false, error: response.error, errorCode: response.errorCode };
    return { success: true, item: response.data?.item };
  }, []);

  const getGuards = useCallback(async () => {
    const response = await foundItemsApi.guards();
    if (response.error) return { success: false, error: response.error, guards: [] as Array<{ id: string; name: string }> };
    return { success: true, guards: ((response.data as { guards?: Array<{ id: string; name: string }> } | undefined)?.guards || []) };
  }, []);

  const getFoundItems = useCallback(async () => {
    const response = await foundItemsApi.list();
    if (response.error) return { success: false, error: response.error, items: [] };
    return { success: true, items: response.data?.items || [] };
  }, []);

  const searchFoundItems = useCallback(async (params: Record<string, string>) => {
    const response = await foundItemsApi.search(params);
    if (response.error) return { success: false, error: response.error, items: [] };
    return { success: true, items: response.data?.items || [] };
  }, []);

  const getFoundMatchSummaries = useCallback(async () => {
    const response = await foundItemsApi.matches();
    if (response.error) return { success: false, error: response.error, summaries: {} };
    return { success: true, summaries: response.data?.summaries || {} };
  }, []);

  const updateFoundItem = useCallback(async (id: string, data: Record<string, string>) => {
    const response = await foundItemsApi.update(id, data);
    if (response.error) return { success: false, error: response.error };
    return { success: true, item: response.data?.item };
  }, []);

  const deleteFoundItem = useCallback(async (id: string) => {
    const response = await foundItemsApi.remove(id);
    if (response.error) return { success: false, error: response.error };
    return { success: true };
  }, []);

  const createMissingItem = useCallback(async (data: {
    item_name: string;
    category: string;
    description: string;
    distinctive_marks: string;
    last_location: string;
    last_seen_date: string;
    authorized: boolean;
    dpa_consent: boolean;
    image?: File;
  }) => {
    const response = await missingItemsApi.create(data);
    if (response.error) return { success: false, error: response.error, errorCode: response.errorCode };
    return { success: true, item: response.data?.item };
  }, []);

  const getClaims = useCallback(async () => {
    const response = await claimsApi.list();
    if (response.error) return { success: false, error: response.error, claims: [] };
    return { success: true, claims: response.data?.claims || [] };
  }, []);

  const createClaim = useCallback(async (data: {
    fpost_id: string;
    claim_reason: string;
    proof_image: File;
    identity_document: File;
    identity_document_type: string;
    dpa_consent: boolean;
    missing_report_id?: string;
  }) => {
    const response = await claimsApi.create(data);
    if (response.error) return { success: false, error: response.error, errorCode: response.errorCode };
    return { success: true, claim: response.data?.claim, auctionNotice: (response.data as { auction_notice?: string | null } | undefined)?.auction_notice || undefined };
  }, []);

  const cancelClaim = useCallback(async (claimId: string) => {
    const response = await claimsApi.cancel(claimId);
    if (response.error) return { success: false, error: response.error };
    return { success: true };
  }, []);

  const getMissingItems = useCallback(async () => {
    const response = await missingItemsApi.list();
    if (response.error) return { success: false, error: response.error, items: [] };
    return { success: true, items: response.data?.items || [] };
  }, []);

  const getMissingMatchSummaries = useCallback(async () => {
    const response = await missingItemsApi.matches();
    if (response.error) return { success: false, error: response.error, summaries: {} };
    return { success: true, summaries: response.data?.summaries || {} };
  }, []);

  const updateMissingItem = useCallback(async (id: string, data: Record<string, string>) => {
    const response = await missingItemsApi.update(id, data);
    if (response.error) return { success: false, error: response.error };
    return { success: true, item: response.data?.item };
  }, []);

  const deleteMissingItem = useCallback(async (id: string) => {
    const response = await missingItemsApi.remove(id);
    if (response.error) return { success: false, error: response.error };
    return { success: true };
  }, []);

  const getPublicMissingItems = useCallback(async () => {
    const response = await missingItemsApi.publicList();
    if (response.error) return { success: false, error: response.error, items: [] };
    return { success: true, items: response.data?.items || [] };
  }, []);

  const refreshSessionFromStorage = useCallback(() => {
    const token = authUtils.getToken();
    const storedUser = authUtils.getUserData();

    if (token && storedUser) {
      setState((prev) => ({
        ...prev,
        user: storedUser,
        isAuthenticated: true,
      }));
      return;
    }

    setState((prev) => ({
      ...prev,
      user: null,
      isAuthenticated: false,
    }));
  }, []);

  const refreshProfile = useCallback(async () => {
    const currentUser = authUtils.getUserData();
    if (!authUtils.getToken() || !currentUser) return { success: false, error: 'No active user session.' };

    const response = await authApi.getProfile();
    if (response.error || !response.data?.user) {
      return { success: false, error: response.error || 'Unable to refresh profile.' };
    }

    const updatedUser: User = { ...currentUser, ...response.data.user };
    // Nothing changed: skip the write, so polling does not re-render the app or reset form fields every few seconds.
    if (JSON.stringify(updatedUser) === JSON.stringify(currentUser)) return { success: true, user: currentUser as User };
    authUtils.setUserData(updatedUser);
    setState((previous) => ({ ...previous, user: updatedUser, isAuthenticated: true }));
    return { success: true, user: updatedUser };
  }, []);

  const updateProfile = useCallback(async (updatedUser: Partial<User>) => {
    const currentUser = state.user ?? authUtils.getUserData();
    if (!currentUser) {
      return { success: false, error: 'No active user found.' };
    }

    const nextUser = {
      ...currentUser,
      ...updatedUser,
      email: updatedUser.email ?? currentUser.email,
      fname: updatedUser.fname ?? currentUser.fname,
      lname: updatedUser.lname ?? currentUser.lname,
      mname: updatedUser.mname ?? currentUser.mname ?? '',
    };

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    const response = await authApi.updateProfile({
      fname: nextUser.fname,
      mname: nextUser.mname,
      lname: nextUser.lname,
      email: nextUser.email,
    });

    if (response.error) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: response.error,
      }));
      return { success: false, error: response.error };
    }

    const savedUser: User = {
      ...nextUser,
      account_id: response.data?.user?.account_id || nextUser.account_id,
      email: response.data?.user?.email || nextUser.email,
      fname: response.data?.user?.fname || nextUser.fname,
      mname: response.data?.user?.mname || nextUser.mname || '',
      lname: response.data?.user?.lname || nextUser.lname,
      campus_id: response.data?.user?.campus_id || nextUser.campus_id || '',
      user_role: response.data?.user?.user_role || nextUser.user_role || 'Others',
      verification_status: response.data?.user?.verification_status || nextUser.verification_status || 'pending',
    };

    authUtils.setUserData(savedUser);
    setState({
      user: savedUser,
      isLoading: false,
      error: null,
      isAuthenticated: true,
    });

    return { success: true, user: savedUser };
  }, [state.user]);

  /**
   * Logout user
   */
  const uploadVerificationDocument = useCallback(async (document: { document: File; document_type?: string; dpa_consent: boolean }) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    const response = await authApi.uploadVerificationDocument(document);

    if (response.error) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: response.error,
      }));
      return { success: false, error: response.error };
    }

    const currentUser = state.user ?? authUtils.getUserData();
    const nextUser = currentUser ? {
      ...currentUser,
      verification_status: response.data?.status || 'pending',
      verification_document_name: response.data?.document_name || document.document.name,
      verification_document_type: response.data?.document_type || document.document_type || '',
      verification_uploaded_at: response.data?.uploaded_at || new Date().toISOString(),
      verification_review_note: '',
    } : null;

    if (nextUser) {
      authUtils.setUserData(nextUser);
      setState({
        user: nextUser,
        isLoading: false,
        error: null,
        isAuthenticated: true,
      });
    }

    return {
      success: true,
      status: response.data?.status || 'pending',
      document_name: response.data?.document_name || document.document.name,
      document_type: response.data?.document_type || document.document_type || '',
    };
  }, [state.user]);

  const logout = useCallback(() => {
    authUtils.clearAuthData();
    setState({
      user: null,
      isLoading: false,
      error: null,
      isAuthenticated: false,
    });
  }, []);

  /**
   * Request password reset OTP
   */
  const forgotPassword = useCallback(async (email: string) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    const response = await authApi.forgotPassword(email);

    if (response.error) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: response.error,
      }));
      return { success: false, error: response.error };
    }

    // Store email for reset step
    sessionStorage.setItem('ebalik_reset_email', email);

    setState((prev) => ({ ...prev, isLoading: false }));
    return { success: true };
  }, []);

  /**
   * Reset password with OTP
   */
  const resetPassword = useCallback(
    async (otp_code: string, new_password: string) => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      const email = sessionStorage.getItem('ebalik_reset_email');
      if (!email) {
        const error = 'Email not found. Please use forgot password again.';
        setState((prev) => ({ ...prev, isLoading: false, error }));
        return { success: false, error };
      }

      const response = await authApi.resetPassword({
        email,
        otp_code,
        new_password,
      });

      if (response.error) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: response.error,
        }));
        return { success: false, error: response.error };
      }

      // Clear session storage
      sessionStorage.removeItem('ebalik_reset_email');

      setState((prev) => ({ ...prev, isLoading: false }));
      return { success: true };
    },
    []
  );

  return {
    // State
    user: state.user,
    isLoading: state.isLoading,
    error: state.error,
    isAuthenticated: state.isAuthenticated,

    // Methods
    register,
    verifyOtp,
    createFoundItem,
    getFoundItems,
    searchFoundItems,
    getFoundMatchSummaries,
    updateFoundItem,
    deleteFoundItem,
    createMissingItem,
    getMissingItems,
    getClaims,
    createClaim,
    getGuards,
    cancelClaim,
    getMissingMatchSummaries,
    updateMissingItem,
    deleteMissingItem,
    getPublicMissingItems,
    login,
    verifyAdminMfa,
    googleLogin,
    updateProfile,
    refreshSessionFromStorage,
    logout,
    forgotPassword,
    resetPassword,
    uploadVerificationDocument,
    refreshProfile,

    // Utilities
    clearError: () => setState((prev) => ({ ...prev, error: null })),
  };
}

export type { User, AuthState };
