import { UserProvider } from "@/lib/contexts/user-context";
import { TanstackQueryProvider } from "@/lib/providers/tanstack-query-provider";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { ThemeProvider } from "next-themes";
import { Geist } from "next/font/google";
import { Header } from "./components/header";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import "./globals.css";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const metadata = {
  metadataBase: new URL(defaultUrl),
  title: "YouTube AI Chat",
  description: "Chat with YouTube videos using AI",
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
      </body>
    </html>
  );
}
