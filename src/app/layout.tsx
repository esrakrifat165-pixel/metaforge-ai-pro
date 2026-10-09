import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "METAFORGE AI PRO — By FER",
  description:
    "Professional AI-powered metadata generation and creative tools for stock contributors.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}