"use client";

import { useState, useRef, useEffect } from "react";

import { isValidYouTubeUrl } from "@/lib/utils/youtube";
import { InputForm } from "./components/input-form";
import { useRouter } from "next/navigation";

export default function Home() {
  const [summary, setSummary] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (summary) {
      router.push("/summary");
    }
  }, [summary]);

  return <InputForm setSummary={setSummary} />;
}
