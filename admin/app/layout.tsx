import type { Metadata } from "next";
import localFont from "next/font/local";
import { ToastProvider } from "@/components/ui/Toast";
import { AuthProvider } from "@/lib/auth-context";
import { OutletFilterProvider } from "@/lib/outlet-context";
import RequireAuth from "@/components/RequireAuth";
import AppChrome from "@/components/AppChrome";
import NavigationProgress from "@/components/ui/NavigationProgress";
import "./globals.css";

// Self-hosted (app/fonts, latin subset, OFL; the licence texts sit beside the files), same as
// the storefront. next/font/google makes an outbound Google Fonts request at dev and build time;
// on a CI runner that fetch failing turned every admin page into a 500 ("next/font/google queries
// have exactly one entry") and the Playwright job never got as far as running a test.
const inter = localFont({
  variable: "--font-inter",
  src: "./fonts/Inter-latin-variable.woff2",
  weight: "100 900",
  display: "swap",
});

const geistMono = localFont({
  variable: "--font-geist-mono",
  src: "./fonts/GeistMono-latin-variable.woff2",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Requital Admin",
  description: "Shop manager admin panel",
};

// Runs before paint (blocking, in <head>) so the page never flashes the
// wrong theme — reads the stored preference and applies the .dark class
// immediately, well before React hydrates. Keep the "requital_theme" key in
// sync with lib/theme.ts — this can't import that constant since it has to
// ship as a literal inline script, not a bundled module.
// Light is the hard default: with no stored preference, this never
// consults window.matchMedia("(prefers-color-scheme: dark)") — dark mode
// only ever activates via the explicit toggle (lib/theme.ts's setTheme),
// never from the OS preference alone.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("requital_theme");
    if (stored === "dark") document.documentElement.classList.add("dark");
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <NavigationProgress />
        <ToastProvider>
          <AuthProvider>
            <OutletFilterProvider>
              <RequireAuth>
                <AppChrome>{children}</AppChrome>
              </RequireAuth>
            </OutletFilterProvider>
          </AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
