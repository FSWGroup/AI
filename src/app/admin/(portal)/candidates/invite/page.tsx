import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { SectionHeading } from "@/components/ui";
import { InviteForm } from "@/components/admin/InviteForm";

export const dynamic = "force-dynamic";

export default async function InvitePage() {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "INVITE_CANDIDATES")) redirect("/admin");

  const openings = await prisma.jobOpening.findMany({
    where: { status: "OPEN" },
    include: { jobProfile: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="mx-auto max-w-2xl">
      <SectionHeading
        title="Invite a candidate"
        description="The candidate receives a secure, expiring link by email. Emails never contain questions or scores."
      />
      <InviteForm
        openings={openings.map((o) => ({
          id: o.id,
          title: o.title,
          profileName: o.jobProfile.name,
        }))}
      />
    </div>
  );
}
