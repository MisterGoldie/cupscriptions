import type { Metadata } from "next";
import localFont from "next/font/local";
import { Providers } from "@/components/Providers";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

const display = localFont({
  src: "./fonts/Syne-Variable.ttf",
  variable: "--font-display",
  weight: "600 800",
  style: "normal",
  display: "swap",
});

const body = localFont({
  src: "./fonts/Figtree-Variable.ttf",
  variable: "--font-body",
  weight: "400 600",
  style: "normal",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Cupscriptions",
    template: "%s · Cupscriptions",
  },
  description:
    "5,000 hand-drawn cups inscribed on Ethereum. Browse the Cupscriptions collection.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} h-full`}>
      <body className="min-h-full flex flex-col antialiased">
        <Providers>
          <SiteHeader />
          <main className="flex-1">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
