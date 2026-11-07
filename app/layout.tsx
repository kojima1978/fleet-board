import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  // 画面ごとの名前をタブに出し、複数のタブや履歴で見分けられるようにする。名前のない画面は今までの題名のまま。
  title: { default: "FleetFlow | 社用車利用管理", template: "%s｜FleetFlow" },
  description: "NFC対応の社用車・駐車場利用管理システム",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
