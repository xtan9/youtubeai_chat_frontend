import { useState, useEffect } from "react";

interface PersistedUrlData {
  url: string;
}

export function usePersistedUrl() {
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    // Only run on client side after hydration
    try {
      const stored = localStorage.getItem("pending-youtube-data");
      if (stored) {
        const data: PersistedUrlData = JSON.parse(stored);
        setPendingUrl(data.url);
      }
    } catch (error) {
      console.error("Error reading from localStorage:", error);
    }
    setIsHydrated(true);
  }, []);

  const savePendingUrl = (url: string) => {
    const data: PersistedUrlData = { url };
    setPendingUrl(url);

    try {
      localStorage.setItem("pending-youtube-data", JSON.stringify(data));
    } catch (error) {
      console.error("Error saving to localStorage:", error);
    }
  };

  const clearPendingUrl = () => {
    setPendingUrl(null);

    try {
      localStorage.removeItem("pending-youtube-data");
    } catch (error) {
      console.error("Error clearing localStorage:", error);
    }
  };

  return {
    // Only return values after hydration to prevent SSR mismatch
    pendingUrl: isHydrated ? pendingUrl : null,
    savePendingUrl,
    clearPendingUrl,
    isHydrated,
  };
}
