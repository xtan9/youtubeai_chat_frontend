import { UserContextProvider } from "@/lib/contexts/user-context";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { Geist } from "next/font/google";
import { Header } from "./components/header";
import "./globals.css";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: "youtubeai.chat - AI Video Summarizer",
  description:
    "Transform YouTube videos into intelligent summaries with AI-powered analysis",
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  display: "swap",
  subsets: ["latin"],
});

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.className} antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <UserContextProvider>
            <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black text-white">
              <Header />
              <div className="relative z-10 container mx-auto px-6 py-12 max-w-6xl">
                {children}
              </div>
            </div>
          </UserContextProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
