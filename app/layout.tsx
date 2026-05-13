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
 *
 * Phase D — accessibility / i18n polish
 * -------------------------------------
 *  • <html lang="af-ZA">: SA Afrikaans is the primary user language
 *    (first client acme-cattle + ops memory). Screen readers and
 *    browser translation prompts now get the right signal. A future
 *    per-user locale system is out of scope for this fix; see TODO
 *    near the <html> tag.
 *  • Skip-to-content link: first focusable child of <body> jumps to
 *    <main id="main">, hidden until focused via Tailwind's
 *    `sr-only` + `focus:not-sr-only` pattern. Saves keyboard / screen
 *    reader users from tabbing through the entire header on every nav.
 *  • next/font already provides preload + display:swap (the defaults),
 *    so the 6 s cold landing-page wall-clock from D3 is addressed by
 *    the existing Geist / Playfair / DM_Sans / DM_Serif_Display
 *    declarations below — no extra <link rel="preload"> needed.
 */

// D3 fix — explicit `display: "swap"` + `preload: true` on every face so
// Next.js emits <link rel="preload" as="font" type="font/woff2" crossOrigin>
// in <head>. These are the next/font defaults, but stating them explicitly
// keeps the intent reviewable and prevents a future "let's tune font
// loading" change from accidentally regressing first-paint.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
  preload: true,
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
  preload: true,
});

const playfair = Playfair_Display({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "600", "700", "900"],
  display: "swap",
  preload: true,
});

const dmSans = DM_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
  preload: true,
});

const dmSerifDisplay = DM_Serif_Display({
  variable: "--font-dm-serif",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  preload: true,
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
    // Visual audit P1 (2026-05-04): every rendered string in the UI is
    // English ("Sign In", "Create Your Account", "Username",
    // …). Declaring `lang="af-ZA"` made screen readers pronounce English
    // copy with Afrikaans phonemes and broke search-engine signals.
    // `en-ZA` matches the rendered copy and still picks up SA-flavoured
    // locale conventions (date format, currency hints).
    //
    // TODO(i18n): when a real Afrikaans translation lands, drive this
    // attribute from a per-user / per-route locale instead of a literal.
    <html lang="en-ZA">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} ${dmSans.variable} ${dmSerifDisplay.variable} antialiased`}
      >
        {/*
          D2 — skip-to-content link. Visually hidden until focused
          (Tailwind's sr-only / focus:not-sr-only pair). Must be the
          first focusable element in <body> so a single Tab from the
          page top reveals it. Activating it scrolls focus to the
          #main wrapper below.

          The wrapper is a <div tabIndex={-1}>, NOT a <main>, because
          nested route layouts (app/[farmSlug]/admin/layout.tsx,
          app/[farmSlug]/tools/layout.tsx, etc.) already render their
          own <main> landmark. Nesting <main> inside <main> violates
          the "single main landmark per document" rule of WAI-ARIA.
          tabIndex={-1} keeps the wrapper programmatically focusable
          (required so the in-page anchor jump moves both scroll and
          keyboard focus on every browser).
        */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[1000] focus:rounded focus:bg-[var(--farm-text)] focus:px-4 focus:py-2 focus:text-white focus:outline-none focus:ring-2 focus:ring-[var(--farm-amber)]"
        >
          Skip to content
        </a>
        <div id="main" tabIndex={-1}>
          {children}
        </div>
      </body>
    </html>
  );
}
