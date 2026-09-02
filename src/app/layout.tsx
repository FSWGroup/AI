import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FSW Talent Scout Assessment",
  description:
    "FSW Group's independent employment assessment platform for hiring and employee development.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
