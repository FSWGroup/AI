import { requirePermission } from "@/lib/auth/guard";
import { getTeamSkillMatrix } from "@/lib/services/skills";
import { PageHeader, PageBody } from "@/components/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icons";
import { PersonAvatar } from "@/components/people/avatar";
import { cn } from "@/lib/utils";

export const metadata = { title: "Team Skills Matrix" };

export default async function TeamSkillsPage() {
  const actor = await requirePermission("skills.view");
  const matrix = await getTeamSkillMatrix(actor, actor.id);

  return (
    <>
      <PageHeader
        title="Team skills matrix"
        description="Current proficiency against position requirements for your reporting line."
        crumbs={[{ label: "Home", href: "/home" }, { label: "Team", href: "/team" }, { label: "Skills" }]}
      />
      <PageBody>
        {matrix.people.length === 0 || matrix.skills.length === 0 ? (
          <EmptyState
            icon={<Icon name="skill" className="h-5 w-5" />}
            title="No skill data yet"
            description="Skills appear here once your reports have position skill requirements or recorded proficiency."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)]">
            <table className="w-full border-collapse text-[0.8125rem]">
              <thead>
                <tr className="bg-[var(--surface-sunken)]">
                  <th scope="col" className="sticky left-0 z-10 min-w-[12rem] border-b border-r border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-2.5 text-left">
                    Person
                  </th>
                  {matrix.skills.map((s) => (
                    <th key={s.id} scope="col" className="min-w-[8rem] border-b border-[var(--border-subtle)] p-2.5 text-left">
                      {s.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.people.map((person) => (
                  <tr key={person.id}>
                    <td className="sticky left-0 z-10 border-b border-r border-[var(--border-subtle)] bg-[var(--surface-card)] p-2.5">
                      <div className="flex items-center gap-2">
                        <PersonAvatar name={person.name} image={person.image} size={26} />
                        <span className="font-medium text-[var(--text-primary)]">{person.name}</span>
                      </div>
                    </td>
                    {matrix.skills.map((skill) => {
                      const cell = matrix.cells[person.id]?.[skill.id];
                      if (!cell) {
                        return (
                          <td key={skill.id} className="border-b border-[var(--border-subtle)] p-2.5 text-[var(--text-muted)]">
                            —
                          </td>
                        );
                      }
                      return (
                        <td key={skill.id} className="border-b border-[var(--border-subtle)] p-2.5">
                          <Badge tone={cell.gap ? "danger" : "success"}>
                            {cell.level}
                            {cell.requiredLevel !== null ? ` / ${cell.requiredLevel}` : ""}
                          </Badge>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={cn("mt-3 text-[0.75rem] text-[var(--text-muted)]")}>
          Red badges mark a gap against the position's required level; green means the requirement is met or there is no requirement.
        </p>
      </PageBody>
    </>
  );
}
