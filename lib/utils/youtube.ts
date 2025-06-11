/**
 * Validates if a given URL is a valid YouTube URL
 * @param url - The URL to validate
 * @returns boolean indicating if the URL is a valid YouTube URL
 */
export function isValidYouTubeUrl(url: string): boolean {
  const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
  return youtubeRegex.test(url);
}

/**
 * Handles authentication errors and provides appropriate error messages
 * @param status - HTTP status code
 * @param message - Error message
 * @returns Object with error message and redirect flag
 */
export function getAuthErrorInfo(status: number, message: string) {
  if (status === 401) {
    return {
      message: "Authentication failed. Please sign in again.",
      shouldRedirect: true,
      redirectDelay: 3000
    };
  } else if (status === 429) {
    return {
      message: "Rate limit exceeded. Please wait before trying again.",
      shouldRedirect: false
    };
  } else {
    return {
      message,
      shouldRedirect: false
    };
  }
} 