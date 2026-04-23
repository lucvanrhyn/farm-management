import type { Metadata } from "next";
import { Geist, Geist_Mono, Playfair_Display, DM_Sans, DM_Serif_Display } from "next/font/google";
import "./globals.css";

/**
 * Minimal root layout. ONLY renders <html>, <body>, fonts and metadata.
 *
 * The SessionProvider, service-worker registrar and web-vitals reporter
 * used to live here, which meant every route — including the ~715 KB
 * login page — bundled the full app shell.
 *
 * Heavy providers now live in <AppShell> (components/AppShell.tsx) and
 * are only pulled into non-auth route subtrees via their own layout
 * files. `/login`, `/register` and `/verify-email` live under the
 * `(auth)` route group (see app/(auth)/layout.tsx) and therefore never
 * import SessionProvider / SWRegistrar / ReportWebVitals.
 */

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "600", "700", "900"],
});

const dmSans = DM_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

const dmSerifDisplay = DM_Serif_Display({
  variable: "--font-dm-serif",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "FarmTrack",
  description: "Livestock farm management system",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "FarmTrack",
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} ${dmSans.variable} ${dmSerifDisplay.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
