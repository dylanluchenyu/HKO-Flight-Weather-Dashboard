import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HKO Flight Weather Dashboard",
  description:
    "Real-time flight situational awareness dashboard for Hong Kong arrivals and weather impact."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
