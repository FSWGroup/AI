import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { LogoutButton } from "@/components/admin/LogoutButton";

export default async function AdminPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/admin/login");

  const nav: { href: string; label: string; show: boolean }[] = [
    { href: "/admin", label: "Dashboard", show: true },
    {
      href: "/admin/recruiting",
      label: "Recruiting",
      show: can(user.role, "VIEW_REQUISITIONS"),
    },
    {
      href: "/admin/candidates",
      label: "Assessments",
      show: can(user.role, "VIEW_CANDIDATES"),
    },
    {
      href: "/admin/jobs",
      label: "Job Profiles",
      show: can(user.role, "MANAGE_BENCHMARKS") || can(user.role, "VIEW_CANDIDATES"),
    },
    {
      href: "/admin/questions",
      label: "Question Bank",
      show: can(user.role, "MANAGE_QUESTIONS"),
    },
    {
      href: "/admin/quality",
      label: "Assessment Quality",
      show: can(user.role, "VIEW_QUALITY"),
    },
    {
      href: "/admin/audit",
      label: "Audit Log",
      show: can(user.role, "VIEW_AUDIT"),
    },
    {
      href: "/admin/settings",
      label: "Settings",
      show: can(user.role, "MANAGE_SYSTEM"),
    },
  ];

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-navy-100 bg-white p-5 sm:flex print:hidden">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-fsw-600">
            FSW Group
          </p>
          <p className="text-lg font-bold text-navy-900">WorkFit Admin</p>
        </div>
        <nav className="mt-8 flex flex-1 flex-col gap-1" aria-label="Admin">
          {nav
            .filter((n) => n.show)
            .map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-navy-700 hover:bg-navy-50 hover:text-navy-900"
              >
                {n.label}
              </Link>
            ))}
        </nav>
        <div className="border-t border-navy-100 pt-4">
          <p className="truncate text-sm font-semibold text-navy-900">{user.name}</p>
          <p className="text-xs text-navy-400">{user.role.replaceAll("_", " ")}</p>
          <LogoutButton />
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6 sm:p-8 print:p-0">{children}</main>
    </div>
  );
}
