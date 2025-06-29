/**
 * API Configuration
 * Handles environment-based API URL configuration
 */

// Get the API base URL from environment variables
const getApiBaseUrl = (): string => {
  // For Next.js, environment variables must start with NEXT_PUBLIC_ to be available in the browser
  const envApiUrl = process.env.NEXT_PUBLIC_API_URL;
  
  if (envApiUrl) {
    return envApiUrl;
  }
  
  // Fallback based on NODE_ENV
  if (process.env.NODE_ENV === 'production') {
    return 'https://api.youtubeai.chat';
  }
  
  // Development fallback
  return 'http://localhost:8001';
};

// Base API URL
export const API_BASE_URL = getApiBaseUrl();

// API Endpoints
export const API_ENDPOINTS = {
  SUMMARIZE_STREAM: `${API_BASE_URL}/summarize/stream`,
  HEALTH: `${API_BASE_URL}/health`,
  // Add other endpoints as needed
} as const;

// Utility function to construct API URLs
export const getApiUrl = (endpoint: string): string => {
  return `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
};

// Debug information (only in development)
if (process.env.NODE_ENV === 'development') {
  console.log('🔗 API Configuration:', {
    baseUrl: API_BASE_URL,
    endpoints: API_ENDPOINTS,
    environment: process.env.NODE_ENV,
    envVar: process.env.NEXT_PUBLIC_API_URL,
  });
}