import { useState, useEffect } from "react";

interface PersistedUrlData {
  url: string;
  useStreaming: boolean;
}

export function usePersistedUrl() {
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [pendingStreaming, setPendingStreaming] = useState<boolean>(false);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    // Only run on client side after hydration
    try {
      const stored = localStorage.getItem("pending-youtube-data");
      console.log("Reading from localStorage:", stored);
      if (stored) {
        const data: PersistedUrlData = JSON.parse(stored);
        console.log("Parsed data:", data);
        setPendingUrl(data.url);
        setPendingStreaming(data.useStreaming || false);
      }
    } catch (error) {
      console.error("Error reading from localStorage:", error);
    }
    setIsHydrated(true);
  }, []);

  const savePendingUrl = (url: string, useStreaming: boolean = false) => {
    const data: PersistedUrlData = { url, useStreaming };
    console.log("Saving to localStorage:", data);
    setPendingUrl(url);
    setPendingStreaming(useStreaming);

    try {
      localStorage.setItem("pending-youtube-data", JSON.stringify(data));
      console.log("Successfully saved to localStorage");
    } catch (error) {
      console.error("Error saving to localStorage:", error);
    }
  };

  const clearPendingUrl = () => {
    setPendingUrl(null);
    setPendingStreaming(false);

    try {
      localStorage.removeItem("pending-youtube-data");
    } catch (error) {
      console.error("Error clearing localStorage:", error);
    }
  };

  return {
    // Only return values after hydration to prevent SSR mismatch
    pendingUrl: isHydrated ? pendingUrl : null,
    pendingStreaming: isHydrated ? pendingStreaming : false,
    savePendingUrl,
    clearPendingUrl,
    isHydrated,
  };
}
