import { createClient } from '@/lib/supabase/client';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://api.youtubeai.chat';

interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  requireAuth?: boolean;
  signal?: AbortSignal;
}

interface ApiError extends Error {
  status: number;
  data?: unknown;
}

class APIClient {
  private supabase = createClient();

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    try {
      const { data: { session }, error } = await this.supabase.auth.getSession();
      
      if (error) {
        console.error('Error getting session:', error);
        throw new Error('Failed to get authentication session');
      }

      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;

      }
    } catch (error) {
      console.error('Error getting auth token:', error);
      throw new Error('Authentication error occurred');
    }

    return headers;
  }

  async request<T = unknown>(
    endpoint: string, 
    options: ApiRequestOptions = {}
  ): Promise<T> {
    const {
      method = 'GET',
      body,
      headers: customHeaders = {},
      requireAuth = true,
      signal
    } = options;

    try {
      // Get auth headers if authentication is required
      let headers = { ...customHeaders };
      if (requireAuth) {
        const authHeaders = await this.getAuthHeaders();
        headers = { ...headers, ...authHeaders };
      }

      const url = `${API_BASE_URL}${endpoint}`;
      
      const requestOptions: RequestInit = {
        method,
        headers,
        signal,
      };

      if (body) {
        requestOptions.body = JSON.stringify(body);
      }

      const response = await fetch(url, requestOptions);

      if (!response.ok) {
        let errorData: unknown;
        try {
          errorData = await response.json();
        } catch {
          errorData = { message: `HTTP ${response.status}` };
        }



        // Extract error message with better handling
        let errorMessage = `Request failed with status ${response.status}`;
        
        if (errorData && typeof errorData === 'object') {
          if ('detail' in errorData && errorData.detail) {
            if (typeof errorData.detail === 'string') {
              errorMessage = errorData.detail;
            } else if (typeof errorData.detail === 'object') {
              errorMessage = JSON.stringify(errorData.detail);
            } else {
              errorMessage = String(errorData.detail);
            }
          } else if ('message' in errorData && errorData.message) {
            if (typeof errorData.message === 'string') {
              errorMessage = errorData.message;
            } else if (typeof errorData.message === 'object') {
              errorMessage = JSON.stringify(errorData.message);
            } else {
              errorMessage = String(errorData.message);
            }
          }
        }

        const error: ApiError = new Error(errorMessage) as ApiError;
        error.status = response.status;
        error.data = errorData;

        throw error;
      }

      // Handle empty responses
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      } else {
        return response as unknown as T;
      }

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }

      throw error;
    }
  }

  // Convenience methods
  async get<T = unknown>(endpoint: string, options: Omit<ApiRequestOptions, 'method'> = {}): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  async post<T = unknown>(endpoint: string, body?: unknown, options: Omit<ApiRequestOptions, 'method' | 'body'> = {}): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'POST', body });
  }

  async put<T = unknown>(endpoint: string, body?: unknown, options: Omit<ApiRequestOptions, 'method' | 'body'> = {}): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'PUT', body });
  }

  async delete<T = unknown>(endpoint: string, options: Omit<ApiRequestOptions, 'method'> = {}): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }

  // Streaming requests
  async stream(
    endpoint: string,
    body?: unknown,
    options: Omit<ApiRequestOptions, 'method' | 'body'> = {}
  ): Promise<ReadableStreamDefaultReader<Uint8Array>> {
    const { requireAuth = true, signal, headers: customHeaders = {} } = options;

    let headers = { ...customHeaders };
    if (requireAuth) {
      const authHeaders = await this.getAuthHeaders();
      headers = { ...headers, ...authHeaders };
    }

    const url = `${API_BASE_URL}${endpoint}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });

    if (!response.ok) {
      let errorData: unknown;
      try {
        errorData = await response.json();
      } catch {
        errorData = { message: `HTTP ${response.status}` };
      }

      // Extract error message with better handling
      let errorMessage = `Streaming request failed with status ${response.status}`;
      
      if (errorData && typeof errorData === 'object') {
        if ('detail' in errorData && errorData.detail) {
          if (typeof errorData.detail === 'string') {
            errorMessage = errorData.detail;
          } else if (typeof errorData.detail === 'object') {
            errorMessage = JSON.stringify(errorData.detail);
          } else {
            errorMessage = String(errorData.detail);
          }
        } else if ('message' in errorData && errorData.message) {
          if (typeof errorData.message === 'string') {
            errorMessage = errorData.message;
          } else if (typeof errorData.message === 'object') {
            errorMessage = JSON.stringify(errorData.message);
          } else {
            errorMessage = String(errorData.message);
          }
        }
      }

      const error: ApiError = new Error(errorMessage) as ApiError;
      error.status = response.status;
      error.data = errorData;

      throw error;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Failed to get response reader for streaming');
    }

    return reader;
  }
}

// Export a singleton instance
export const apiClient = new APIClient();

// Export types for use in components
export type { ApiError };
export { APIClient }; 