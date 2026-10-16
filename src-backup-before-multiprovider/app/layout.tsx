import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemeProvider } from "../components/ThemeProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "METAFORGE AI PRO \u2014 By FER",
    template: "%s | METAFORGE AI PRO",
  },
  description:
    "AI-powered metadata generation and creative tools for stock content contributors.",
};

// Runs before the page is drawn so the saved theme is applied immediately
// (this prevents a dark-to-light flash). The key must match STORAGE_KEY in
// src/components/ThemeProvider.tsx. Dark is the default theme.
const themeInitScript = `
(function () {
  try {
    var saved = window.localStorage.getItem("metaforge-theme");
    document.documentElement.dataset.theme = saved === "light" ? "light" : "dark";
  } catch (error) {
    document.documentElement.dataset.theme = "dark";
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}