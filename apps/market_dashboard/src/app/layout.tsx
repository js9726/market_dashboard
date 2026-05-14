import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import Providers from "./providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Market Desk JS",
  description: "Conviction Desk, market snapshot, morning brief, and stock analysis",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-mode="light">
      <body className={`${inter.className} ds-base`} data-mode="light">
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
