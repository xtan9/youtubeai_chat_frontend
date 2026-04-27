import { UserProvider } from "@/lib/contexts/user-context";
import { TanstackQueryProvider } from "@/lib/providers/tanstack-query-provider";
import { ThemeProvider } from "@/lib/providers/theme-provider";
import { PostHogProvider } from "@/lib/providers/posthog-provider";
import { PostHogUserIdentifier } from "@/components/posthog-user-identifier";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Geist } from "next/font/google";
import { Header } from "./components/header";
import { Footer } from "@/components/footer";
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
  authors: [{ name: "YouTubeAI" }],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "AI YouTube Video Summarizer - Get Quick Video Summaries for Free",
    description:
      "Get instant AI summaries of any YouTube video. Extract key points and main ideas in seconds - 100% free tool for faster video comprehension.",
    url: "https://www.youtubeai.chat",
    siteName: "YouTubeAI Summary",
    type: "website",
    locale: "en_US",
    images: [
      {
        url: "/youtube-summary-demo.png",
        width: 1919,
        height: 1244,
        alt: "YouTubeAI Summary — instant AI summaries of YouTube videos",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AI YouTube Video Summarizer",
    description:
      "Get instant AI summaries of any YouTube video. Extract key points and main ideas in seconds.",
    creator: "@YouTubeAI",
    images: ["/youtube-summary-demo.png"],
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
  // No `icons` config — `app/favicon.ico` is auto-served by Next.js' file
  // convention, so an explicit override is unnecessary. The previous list
  // declared 12 size-specific PNG variants (favicon-16/32/96 + 9 apple-icon
  // sizes) that didn't exist in /public, generating 12× 404s on every page
  // load. If we want size-specific icons, ship the files and re-add the
  // entries; otherwise let the convention handle it.
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
        {/* Global structured data renders inside <head> — Google's preferred
            placement. Page-specific schemas (FAQ, HowTo, BreadcrumbList,
            WebPage) stay in body since they live with their pages. */}
        <StructuredData />
      </head>
      <body className={`${geist.className} flex min-h-screen flex-col`}>
        <PostHogProvider>
          <ThemeProvider>
            <TanstackQueryProvider>
              <UserProvider>
                <PostHogUserIdentifier />
                <Header />
                <main className="flex-1">{children}</main>
                <Footer />
                <Sonner />
                <ReactQueryDevtools initialIsOpen={false} />
              </UserProvider>
            </TanstackQueryProvider>
          </ThemeProvider>
          {process.env.NEXT_PUBLIC_GA_ID?.trim() &&
            process.env.NODE_ENV === "production" && (
              <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_ID.trim()} />
            )}
        </PostHogProvider>
      </body>
    </html>
  );
}
