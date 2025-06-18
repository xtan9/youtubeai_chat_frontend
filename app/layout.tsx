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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#000000",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://www.youtubeai.chat"),
  title: "100% Free AI YouTube Video Summarizer - YouTubeAI.chat",
  description:
    "Get instant AI summaries of any YouTube video. Extract key points and main ideas in seconds - 100% free tool for faster video comprehension.",
  keywords:
    "youtube summarizer, video summary, AI video summary, youtube transcript, free youtube summary tool, video key points extractor, youtube video summary, AI summary generator",
  authors: [{ name: "YouTubeAI" }],
  openGraph: {
    title: "AI YouTube Video Summarizer - Get Quick Video Summaries for Free",
    description:
      "Get instant AI summaries of any YouTube video. Extract key points and main ideas in seconds - 100% free tool for faster video comprehension.",
    url: "https://www.youtubeai.chat",
    siteName: "YouTubeAI Summary",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI YouTube Video Summarizer",
    description:
      "Get instant AI summaries of any YouTube video. Extract key points and main ideas in seconds.",
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
  applicationName: "YouTubeAI Summary",
  appleWebApp: {
    title: "YouTubeAI Summary",
    statusBarStyle: "default",
    capable: true,
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

const geist = Geist({
  subsets: ["latin"],
  display: "swap",
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#000000" />
      </head>
      <body className={geist.className}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <TanstackQueryProvider>
            <UserProvider>
              <Header />
              <StructuredData />
              {children}
              <Sonner />
              <ReactQueryDevtools initialIsOpen={false} />
            </UserProvider>
          </TanstackQueryProvider>
        </ThemeProvider>
        {process.env.NEXT_PUBLIC_GA_ID && (
          <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_ID} />
        )}
      </body>
    </html>
  );
}
