import type { Metadata } from "next";
// フォントは Google Fonts から取らず、手元のファイル（app/fonts.css・public/fonts/）を使う。会場でネットにつながらなくても落ちない
import "./fonts.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "ネタ帳Agent",
  description: "社内の取り組みをカードにまとめ続け、登壇やブログの依頼に候補と声かけの下書きを出すAgent",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
