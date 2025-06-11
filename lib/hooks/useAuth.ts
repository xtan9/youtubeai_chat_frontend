import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Session } from '@supabase/supabase-js';

interface AuthState {
  session: Session | null;
  isLoading: boolean;
  error: string | null;
}

export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>({
    session: null,
    isLoading: true,
    error: null
  });

  const supabase = createClient();

  const getAuthHeaders = async (): Promise<{ [key: string]: string }> => {
    const headers: { [key: string]: string } = {
      "Content-Type": "application/json",
    };

    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (error) {
        console.error("Error getting session:", error);
        setAuthState(prev => ({ ...prev, error: "Failed to get authentication session" }));
        return headers;
      }

      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
        console.log("Added JWT token to request headers");
      } else {
        console.warn("No access token available in session");
        setAuthState(prev => ({ ...prev, error: "No valid authentication token found" }));
      }
    } catch (error) {
      console.error("Error getting auth token:", error);
      setAuthState(prev => ({ ...prev, error: "Authentication error occurred" }));
    }

    return headers;
  };

  const refreshSession = useCallback(async () => {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (error) {
        setAuthState({ session: null, isLoading: false, error: error.message });
      } else {
        setAuthState({ session, isLoading: false, error: null });
      }
    } catch (error) {
      setAuthState({ 
        session: null, 
        isLoading: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }, [supabase.auth]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setAuthState({ session: null, isLoading: false, error: null });
  };

  useEffect(() => {
    // Get initial session
    refreshSession();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log('Auth state changed:', event, session);
        setAuthState({ session, isLoading: false, error: null });
      }
    );

    return () => subscription.unsubscribe();
  }, [refreshSession, supabase.auth]);

  return {
    ...authState,
    getAuthHeaders,
    refreshSession,
    signOut,
    isAuthenticated: !!authState.session,
    user: authState.session?.user || null
  };
} 