import type { Metadata } from "next";
import { Geist_Mono, Inter, Playfair_Display, Poppins, Roboto } from "next/font/google";
import "./globals.css";

// Curated font set (see lib/types.ts's FONT_CHOICES) — every shop's font
// pick is one of these four, preloaded here rather than fetched per-request,
// since Next's font loader needs static imports. lib/shop-context.tsx picks
// among them at runtime by pointing --font-sans at the matching variable.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const poppins = Poppins({ variable: "--font-poppins", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const playfairDisplay = Playfair_Display({ variable: "--font-playfair-display", subsets: ["latin"] });
const roboto = Roboto({ variable: "--font-roboto", subsets: ["latin"], weight: ["400", "500", "700"] });

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Requital Storefront",
  description: "Shop online",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${poppins.variable} ${playfairDisplay.variable} ${roboto.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
