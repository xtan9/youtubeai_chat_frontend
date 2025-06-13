"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

// BAD: Creates new QueryClient on every render
const BadProvider = ({ children }: { children: React.ReactNode }) => {
  console.log("BadProvider rendering, creating new QueryClient");
  const queryClient = new QueryClient();
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

// GOOD: Creates QueryClient only once
const GoodProvider = ({ children }: { children: React.ReactNode }) => {
  console.log("GoodProvider rendering");
  const [queryClient] = useState(() => {
    console.log("Creating QueryClient (only happens once)");
    return new QueryClient();
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

// Test component to force re-renders
const TestComponent = () => {
  const [count, setCount] = useState(0);

  return (
    <div>
      <button onClick={() => setCount((c) => c + 1)}>
        Re-render ({count})
      </button>
    </div>
  );
};
