import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Curated font set (see lib/types.ts's FONT_CHOICES) — every shop's font
// pick is one of these, self-hosted from app/fonts (latin subset, OFL; the
// licence texts sit beside the files) so neither build nor dev ever makes an
// outbound Google Fonts request. Same families, weights and CSS variables as
// the former next/font/google setup. Inter / Playfair Display / Geist Mono
// are variable-weight files; Roboto is one variable file declared as three
// faces. lib/shop-context.tsx picks among them at runtime by pointing
// --font-sans at the matching variable.
const inter = localFont({
  variable: "--font-inter",
  src: "./fonts/Inter-latin-variable.woff2",
  weight: "100 900",
  display: "swap",
});
const poppins = localFont({
  variable: "--font-poppins",
  src: [
    { path: "./fonts/Poppins-latin-400.woff2", weight: "400" },
    { path: "./fonts/Poppins-latin-500.woff2", weight: "500" },
    { path: "./fonts/Poppins-latin-600.woff2", weight: "600" },
    { path: "./fonts/Poppins-latin-700.woff2", weight: "700" },
  ],
  display: "swap",
});
const playfairDisplay = localFont({
  variable: "--font-playfair-display",
  src: "./fonts/PlayfairDisplay-latin-variable.woff2",
  weight: "400 900",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});
const roboto = localFont({
  variable: "--font-roboto",
  // Three discrete faces (not one 400-700 range) to match the old
  // weight: ["400","500","700"] exactly: an in-between request such as 600
  // snaps to the 700 face rather than rendering a true 600 on the wght axis.
  src: [
    { path: "./fonts/Roboto-latin-variable.woff2", weight: "400" },
    { path: "./fonts/Roboto-latin-variable.woff2", weight: "500" },
    { path: "./fonts/Roboto-latin-variable.woff2", weight: "700" },
  ],
  display: "swap",
});
const geistMono = localFont({
  variable: "--font-geist-mono",
  src: "./fonts/GeistMono-latin-variable.woff2",
  weight: "100 900",
  display: "swap",
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
