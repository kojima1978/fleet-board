import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FleetFlow | 社用車利用管理",
  description: "NFC対応の社用車・駐車場利用管理システム",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
