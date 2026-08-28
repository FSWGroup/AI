import Link from "next/link";
import { requireActor } from "@/lib/auth/guard";
import { getAppName } from "@/lib/settings";
import { PageHeader, PageBody, SectionHeading } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Glyph } from "@/components/icons";

const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: "⌘K / Ctrl+K", description: "Open search and quick commands from anywhere." },
  { keys: "↑ / ↓", description: "Move between results in the command palette." },
  { keys: "Enter", description: "Open the highlighted result or command." },
  { keys: "Esc", description: "Close a dialog, the command palette, or the mobile menu." },
  { keys: "Tab / Shift+Tab", description: "Move between interactive elements; focus is always visible." },
];

export default async function HelpPage() {
  const actor = await requireActor();
  const appName = await getAppName();

  return (
    <div>
      <PageHeader title="Help & getting started" description={`Everything you need to find your way around ${appName}.`} />
      <PageBody className="flex max-w-3xl flex-col gap-8">
        <section>
          <SectionHeading title="What this is" />
          <p className="text-[0.9375rem] leading-relaxed text-[var(--text-secondary)]">
            {appName} is where you complete required training, read SOPs and policies, track certifications, and get quick answers with Ask FSW
            AI. Everything you&apos;re assigned shows up on your <Link href="/home" className="font-medium underline">home page</Link> — due
            soon, overdue, and where you left off.
          </p>
        </section>

        <section>
          <SectionHeading title="Finding things" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card>
              <CardContent className="flex flex-col gap-1.5">
                <Glyph name="search" className="h-5 w-5 text-[var(--brand-secondary)]" />
                <p className="font-medium text-[var(--text-primary)]">Search (⌘K)</p>
                <p className="text-[0.8125rem] text-[var(--text-muted)]">Search SOPs, courses, people, and skills from anywhere — results only show what you&apos;re allowed to see.</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex flex-col gap-1.5">
                <Glyph name="menu" className="h-5 w-5 text-[var(--brand-secondary)]" />
                <p className="font-medium text-[var(--text-primary)]">The library</p>
                <p className="text-[0.8125rem] text-[var(--text-muted)]">
                  Browse the full <Link href="/catalog" className="underline">course catalog</Link> or{" "}
                  <Link href="/sops" className="underline">SOP library</Link> from the sidebar.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex flex-col gap-1.5">
                <Glyph name="sparkle" className="h-5 w-5 text-[var(--brand-secondary)]" />
                <p className="font-medium text-[var(--text-primary)]">Ask FSW AI</p>
                <p className="text-[0.8125rem] text-[var(--text-muted)]">
                  Ask a question in plain language from <Link href="/ask" className="underline">Ask FSW AI</Link> and get an answer with
                  clickable citations back to the source SOP or course.
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        <section>
          <SectionHeading title="Completing training" />
          <ul className="list-disc space-y-1.5 pl-5 text-[0.9375rem] leading-relaxed text-[var(--text-secondary)]">
            <li>Open a course from your home page or <Link href="/my-training" className="underline">My Training</Link> and work through its lessons in order.</li>
            <li>Video lessons track your watch percentage automatically — you don&apos;t need to do anything except watch.</li>
            <li>Quizzes show your result immediately; if a course allows retakes, you&apos;ll see how many attempts remain.</li>
            <li>Some lessons need a manager sign-off or a practical demonstration — your manager completes those from their Team view.</li>
            <li>Certificates appear on your <Link href="/certificates" className="underline">Certificates</Link> page as soon as you complete a certifying course.</li>
          </ul>
        </section>

        <section>
          <SectionHeading title="Reporting outdated information" />
          <p className="text-[0.9375rem] leading-relaxed text-[var(--text-secondary)]">
            Every SOP and lesson has a feedback control — mark it <strong>Outdated</strong> and add a note. That goes straight to the content
            owner and shows up on the admin Content Health dashboard so it doesn&apos;t get lost.
          </p>
        </section>

        <section>
          <SectionHeading title="Keyboard shortcuts" />
          <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)]">
            <table className="w-full text-[0.8125rem]">
              <tbody>
                {SHORTCUTS.map((s) => (
                  <tr key={s.keys} className="border-b border-[var(--border-subtle)] last:border-0">
                    <td className="w-40 px-3.5 py-2">
                      <kbd className="rounded border border-[var(--border-default)] bg-[var(--surface-sunken)] px-1.5 py-0.5 font-mono text-[0.75rem]">{s.keys}</kbd>
                    </td>
                    <td className="px-3.5 py-2 text-[var(--text-secondary)]">{s.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <SectionHeading title="Who to contact" />
          <ul className="space-y-1.5 text-[0.9375rem] leading-relaxed text-[var(--text-secondary)]">
            <li>
              <strong className="text-[var(--text-primary)]">Access or account issues:</strong> your manager, or an HR administrator via{" "}
              <Link href="/people" className="underline">the people directory</Link>.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">A specific SOP or course seems wrong:</strong> use its Outdated/feedback control, or
              contact the owner shown on that page.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">Something is broken:</strong> contact your platform administrator with what you were
              doing and, if shown, the error reference.
            </li>
          </ul>
          <p className="mt-2 text-[0.8125rem] text-[var(--text-muted)]">Signed in as {actor.email}.</p>
        </section>
      </PageBody>
    </div>
  );
}
