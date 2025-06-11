"use client";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export default function TestOAuth() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const testGoogleOAuth = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/protected`,
        },
      });
      
      if (error) {
        setError(error.message);
      } else {

      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-lg shadow-md p-6">
        <h1 className="text-2xl font-bold text-center mb-6">Test Google OAuth</h1>
        
        <Button
          onClick={testGoogleOAuth}
          disabled={loading}
          className="w-full"
        >
          {loading ? "Testing..." : "Test Google Sign-In"}
        </Button>
        
        {error && (
          <div className="mt-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            <p className="text-sm">Error: {error}</p>
            <p className="text-xs mt-2">
              This likely means Google OAuth is not configured in Supabase.
            </p>
          </div>
        )}
        
        <div className="mt-6 text-sm text-gray-600">
          <p><strong>To fix this:</strong></p>
          <ol className="list-decimal list-inside mt-2 space-y-1">
            <li>Go to Google Cloud Console</li>
            <li>Create OAuth 2.0 credentials</li>
            <li>Enable Google provider in Supabase</li>
            <li>Add the credentials to Supabase</li>
          </ol>
        </div>
      </div>
    </div>
  );
} 