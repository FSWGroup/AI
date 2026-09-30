import type { Metadata } from "next";
import "./globals.css";
import { getSession } from "@/lib/session";
import { TopBar } from "@/components/TopBar";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Welsford Product Intelligence", description: "Evidence-gated product intelligence for Welsford and ValveMan" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <html lang="en">
      <body>
        <TopBar session={session} />
        <main className="mx-auto max-w-[1500px] px-4 py-4">{children}</main>
        <footer className="mx-auto max-w-[1500px] px-4 py-6 text-[11px] text-slate-500">Every statement shown is a gated claim with citations; abstentions are answers. Fixture data is labeled FIXTURE.</footer>
      </body>
    </html>
  );
}
