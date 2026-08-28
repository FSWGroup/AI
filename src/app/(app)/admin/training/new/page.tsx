import type { Metadata } from "next";
import { Difficulty } from "@prisma/client";
import { requirePermission } from "@/lib/auth/guard";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createCourseAndRedirect } from "@/app/(app)/admin/training/actions";

export const metadata: Metadata = { title: "New Course" };

const DIFFICULTY_LABEL: Record<string, string> = {
  INTRO: "Intro",
  BEGINNER: "Beginner",
  INTERMEDIATE: "Intermediate",
  ADVANCED: "Advanced",
};

export default async function NewCoursePage() {
  await requirePermission("training.create");

  return (
    <>
      <PageHeader
        title="New course"
        description="Start with the basics — you'll add sections, lessons, and quizzes next."
        crumbs={[{ label: "Training admin", href: "/admin/training" }, { label: "New course" }]}
      />
      <PageBody className="max-w-2xl">
        <Card>
          <CardContent className="py-6">
            <form action={createCourseAndRedirect} className="flex flex-col gap-4">
              <Field label="Title" htmlFor="title" required>
                <Input id="title" name="title" required maxLength={200} />
              </Field>
              <Field label="Description" htmlFor="description">
                <Textarea id="description" name="description" rows={3} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Category" htmlFor="category">
                  <Input id="category" name="category" placeholder="e.g. Compliance" />
                </Field>
                <Field label="Difficulty" htmlFor="difficulty">
                  <Select id="difficulty" name="difficulty" defaultValue="BEGINNER">
                    {Object.values(Difficulty).map((d) => (
                      <option key={d} value={d}>
                        {DIFFICULTY_LABEL[d]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Estimated minutes" htmlFor="estimatedMinutes" hint="Total time to complete the course">
                <Input id="estimatedMinutes" name="estimatedMinutes" type="number" min={0} />
              </Field>
              <div>
                <Button type="submit">Create course</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
