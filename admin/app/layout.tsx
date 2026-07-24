import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ToastProvider } from "@/components/ui/Toast";
import { AuthProvider } from "@/lib/auth-context";
import { OutletFilterProvider } from "@/lib/outlet-context";
import RequireAuth from "@/components/RequireAuth";
import TopBar from "@/components/TopBar";
import NavTracker from "@/components/NavTracker";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Requital Admin",
  description: "Shop manager admin panel",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <NavTracker />
        <ToastProvider>
          <AuthProvider>
            <OutletFilterProvider>
              <RequireAuth>
                <TopBar />
                <main className="p-6">{children}</main>
              </RequireAuth>
            </OutletFilterProvider>
          </AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
