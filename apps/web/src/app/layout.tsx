import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted variable fonts (SIL OFL, see src/fonts/README.md): no third-party requests.
const jakarta = localFont({
  src: "../fonts/plus-jakarta-sans-latin-wght-normal.woff2",
  variable: "--font-jakarta",
  weight: "200 800",
  display: "swap",
});
const bricolage = localFont({
  src: "../fonts/bricolage-grotesque-latin-wght-normal.woff2",
  variable: "--font-bricolage",
  weight: "200 800",
  display: "swap",
});

// Render every page per request so the CSP nonce from src/proxy.ts can be applied to
// Next.js scripts (statically prerendered pages cannot carry a per-request nonce).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "QuickAssign", template: "%s · QuickAssign" },
  description: "Never miss an assignment from your class WhatsApp groups.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#059669",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${bricolage.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
