import type { Metadata } from "next";
import { abcRepro, abcReproMono } from "./fonts/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Simli App (ElevenLabs)",
  description: "create-simli-app (ElevenLabs)",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${abcReproMono.variable} ${abcRepro.variable}`}>
      <body className="font-abc-repro">{children}</body>
    </html>
  );
}
