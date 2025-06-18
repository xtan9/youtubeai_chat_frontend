import { UserProvider } from "@/lib/contexts/user-context";
import { TanstackQueryProvider } from "@/lib/providers/tanstack-query-provider";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { ThemeProvider } from "next-themes";
import { Geist } from "next/font/google";
import { Header } from "./components/header";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import StructuredData from "@/components/seo/structured-data";
import { GoogleAnalytics } from "@next/third-parties/google";
import type { Viewport, Metadata } from "next";
import "./globals.css";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#000000",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://youtubeai.chat"),
  title: "AI YouTube Video Summarizer - Get Quick Video Summaries for Free",
  description:
    "Transform any YouTube video into a concise summary instantly. Get key points, main ideas, and quick insights from videos using AI - 100% free tool for faster video comprehension.",
  keywords:
    "youtube summarizer, video summary, AI video summary, youtube transcript, free youtube summary tool, video key points extractor, youtube video summary, AI summary generator",
  authors: [{ name: "YouTubeAI" }],
  openGraph: {
    title: "AI YouTube Video Summarizer - Get Quick Video Summaries for Free",
    description:
      "Transform any YouTube video into a concise summary instantly. Get key points, main ideas, and quick insights from videos using AI - 100% free tool for faster video comprehension.",
    url: "https://youtubeai.chat",
    siteName: "YouTubeAI Summary",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI YouTube Video Summarizer",
    description:
      "Transform any YouTube video into a concise summary instantly. Get key points and main ideas using AI.",
    creator: "@YouTubeAI",
  },
  robots: {
    index: true,
    follow: true,
    "max-image-preview": "large",
    "max-snippet": -1,
    "max-video-preview": -1,
    googleBot: "index, follow",
  },
  alternates: {
    canonical: "https://youtubeai.chat",
  },
  applicationName: "YouTubeAI Summary",
  appleWebApp: {
    title: "YouTubeAI Summary",
    statusBarStyle: "default",
    capable: true,
  },
  verification: {
    google: "YOUR_VERIFICATION_CODE", // Add your Google Search Console verification code
  },
  icons: {
    icon: [
      { url: "/favicon.ico", type: "image/x-icon" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-96x96.png", sizes: "96x96", type: "image/png" },
    ],
    apple: [
      { url: "/apple-icon-57x57.png", sizes: "57x57", type: "image/png" },
      { url: "/apple-icon-60x60.png", sizes: "60x60", type: "image/png" },
      { url: "/apple-icon-72x72.png", sizes: "72x72", type: "image/png" },
      { url: "/apple-icon-76x76.png", sizes: "76x76", type: "image/png" },
      { url: "/apple-icon-114x114.png", sizes: "114x114", type: "image/png" },
      { url: "/apple-icon-120x120.png", sizes: "120x120", type: "image/png" },
      { url: "/apple-icon-144x144.png", sizes: "144x144", type: "image/png" },
      { url: "/apple-icon-152x152.png", sizes: "152x152", type: "image/png" },
      { url: "/apple-icon-180x180.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  display: "swap",
  subsets: ["latin"],
});

const geistMono = Geist({
  variable: "--font-geist-mono",
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
      <head>
        <StructuredData />
      </head>
      <body
        className={`${geistSans.className} ${geistMono.className} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <UserProvider>
            <TanstackQueryProvider>
              <ReactQueryDevtools initialIsOpen={false} />
              <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black text-white">
                <Header />
                <div className="relative z-10 container mx-auto px-6 py-12 max-w-6xl">
                  {children}
                </div>
              </div>
              <Sonner />
            </TanstackQueryProvider>
          </UserProvider>
        </ThemeProvider>
        {process.env.NODE_ENV === "production" && (
          <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_ID || ""} />
        )}
      </body>
    </html>
  );
}
