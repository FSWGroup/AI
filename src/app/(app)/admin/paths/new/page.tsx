import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createPathAndRedirect } from "@/app/(app)/admin/paths/actions";

export const metadata: Metadata = { title: "New Learning Path" };

export default async function NewPathPage() {
  await requirePermission("path.create");

  return (
    <>
      <PageHeader
        title="New learning path"
        description="Start with a title — you'll add items and due dates next."
        crumbs={[{ label: "Learning paths admin", href: "/admin/paths" }, { label: "New path" }]}
      />
      <PageBody className="max-w-2xl">
        <Card>
          <CardContent className="py-6">
            <form action={createPathAndRedirect} className="flex flex-col gap-4">
              <Field label="Title" htmlFor="title" required>
                <Input id="title" name="title" required maxLength={200} />
              </Field>
              <Field label="Description" htmlFor="description">
                <Textarea id="description" name="description" rows={3} />
              </Field>
              <div>
                <Button type="submit">Create path</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
