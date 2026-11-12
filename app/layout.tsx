import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "cachewhisper",
  description: "A covert channel between two agents through a shared LLM's prompt cache.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
