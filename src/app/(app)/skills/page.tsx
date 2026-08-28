import Link from "next/link";
import { requirePermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/icons";

export const metadata = { title: "Skills Library" };

export default async function SkillsLibraryPage() {
  const actor = await requirePermission("skills.view");

  const [skills, mySkills, skillLevels] = await Promise.all([
    prisma.skill.findMany({ where: { isActive: true }, orderBy: [{ category: "asc" }, { name: "asc" }] }),
    prisma.userSkill.findMany({ where: { userId: actor.id } }),
    prisma.skillLevel.findMany({ orderBy: { value: "asc" } }),
  ]);

  const levelNameByValue = new Map(skillLevels.map((l) => [l.value, l.name]));
  const myLevelBySkill = new Map(mySkills.map((s) => [s.skillId, s.level]));

  const byCategory = new Map<string, typeof skills>();
  for (const skill of skills) {
    const key = skill.category ?? "Other";
    const list = byCategory.get(key) ?? [];
    list.push(skill);
    byCategory.set(key, list);
  }

  return (
    <>
      <PageHeader
        title="Skills library"
        description="Browse the skills catalog and see your current proficiency."
        crumbs={[{ label: "Home", href: "/home" }, { label: "Skills" }]}
      />
      <PageBody className="flex flex-col gap-6">
        {skills.length === 0 ? (
          <EmptyState icon={<Icon name="skill" className="h-5 w-5" />} title="No skills configured yet" />
        ) : (
          [...byCategory.entries()].map(([category, items]) => (
            <div key={category}>
              <h2 className="mb-2.5 text-[0.8125rem] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{category}</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((skill) => {
                  const myLevel = myLevelBySkill.get(skill.id);
                  return (
                    <Link key={skill.id} href={`/skills/${skill.id}`} className="group block">
                      <Card className="h-full transition-colors group-hover:border-[var(--border-strong)]">
                        <CardContent className="flex flex-col gap-1.5">
                          <p className="text-[0.875rem] font-semibold text-[var(--text-primary)] group-hover:underline">{skill.name}</p>
                          {skill.description && (
                            <p className="line-clamp-2 text-[0.75rem] text-[var(--text-muted)]">{skill.description}</p>
                          )}
                          <div>
                            {myLevel !== undefined ? (
                              <Badge tone="blue">My level: {levelNameByValue.get(myLevel) ?? myLevel}</Badge>
                            ) : (
                              <Badge tone="neutral">Not yet demonstrated</Badge>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </PageBody>
    </>
  );
}
