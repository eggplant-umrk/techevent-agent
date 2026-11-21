import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "登壇マッチングAgent",
  description: "登壇依頼に対して、社内の誰にどのテーマで話してもらうかを提案するAgent",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
