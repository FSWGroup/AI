import Link from "next/link";
import { requirePermission } from "@/lib/auth/guard";
import { listSkillLevels, listSkills } from "@/lib/services/skills";
import { PageHeader, PageBody } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icons";
import { SkillsAdminTabs } from "@/app/(app)/admin/skills/skills-admin-tabs";

export const metadata = { title: "Admin — Skills" };

export default async function AdminSkillsPage() {
  const actor = await requirePermission("skills.manage");
  const [skills, levels] = await Promise.all([listSkills(actor), listSkillLevels(actor)]);

  return (
    <>
      <PageHeader
        title="Skills administration"
        description="The skills library and the proficiency scale used across assessments and the skills matrix."
        crumbs={[{ label: "Admin", href: "/admin" }, { label: "Skills" }]}
        actions={
          <Link href="/admin/organization">
            <Button variant="outline">
              <Icon name="org" className="h-4 w-4" /> Position requirements
            </Button>
          </Link>
        }
      />
      <PageBody>
        <SkillsAdminTabs skills={skills} levels={levels} />
      </PageBody>
    </>
  );
}
