import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Closeup Marketing",
  description: "Dashboard interno de Closeup Marketing.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
