import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Momentum · Goal & Plan Tracker",
  description:
    "Set measurable goals with deadlines, break skills into step-by-step plans, and see exactly what you need to do each week to stay on track.",
  keywords: ["goals", "habits", "tracking", "planning", "progress"],
  // installable PWA: boots offline (service worker + cached shell),
  // lists your synced to-dos from the on-device snapshot
  manifest: "/manifest.webmanifest",
  applicationName: "Momentum",
  appleWebApp: {
    capable: true,
    title: "Momentum",
    statusBarStyle: "default",
  },
  icons: {
    // the Momentum mark: M as an ascending progress line (see public/favicon.svg)
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f6" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1c1e" },
  ],
} as const;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <Providers>{children}</Providers>
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
