import Link from "next/link";
import { DEV_USERS, type Session } from "@/lib/session";
import { setSessionAction } from "@/app/actions/session";
import { Badge } from "./Badge";
import { SessionForm } from "./SessionForm";

const INTERNAL_NAV = [
  ["/", "Dashboard"], ["/ask", "Ask"], ["/finder", "Product Finder"], ["/xref", "Cross Reference"], ["/rfq", "RFQ / BOM"], ["/products", "Products"],
  ["/assemblies", "Assemblies"], ["/documents", "Documents"], ["/review", "Review"], ["/conflicts", "Conflicts"], ["/sources", "Sources"], ["/evaluations", "Evaluations"], ["/admin", "Admin"],
] as const;
const PUBLIC_NAV = [["/ask", "Ask"], ["/finder", "Product Finder"], ["/xref", "Cross Reference"], ["/products", "Products"], ["/documents", "Documents"]] as const;

export function TopBar({ session }: { session: Session }) {
  const nav = session.isInternal ? INTERNAL_NAV : PUBLIC_NAV;
  return (
    <header className="border-b border-slate-300 bg-white">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-2 px-4 py-2">
        <div className="flex items-center gap-3">
          <Link href={session.isInternal ? "/" : "/ask"} className="text-base font-semibold tracking-tight text-slate-900 hover:no-underline">Welsford Product Intelligence</Link>
          <Badge tone={session.channel === "welsford" ? "blue" : "green"}>{session.channel === "welsford" ? "Welsford channel" : "ValveMan channel"}</Badge>
          {session.state ? <Badge tone="neutral">state {session.state}</Badge> : null}
          <Badge tone={session.isInternal ? "neutral" : "grey"} title={session.principal.permissions.size ? [...session.principal.permissions].join(", ") : "no permissions"}>{session.principal.displayName} · {session.principal.roleId}</Badge>
        </div>
        <SessionForm action={setSessionAction} users={DEV_USERS.map((u) => ({ value: u.value, label: u.label }))} userKey={session.userKey} channel={session.channel} state={session.state ?? ""} internal={session.isInternal} />
      </div>
      <nav className="mx-auto flex max-w-[1500px] flex-wrap gap-1 px-4 pb-1">
        {nav.map(([href, label]) => <Link key={href} href={href} className="rounded px-2 py-1 text-[12.5px] font-medium text-slate-700 hover:bg-slate-100 hover:no-underline">{label}</Link>)}
      </nav>
    </header>
  );
}
