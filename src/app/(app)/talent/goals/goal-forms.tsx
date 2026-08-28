'use client';

import { Field, Input, Select, Textarea } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/client';
import { saveGoalAction, updateGoalProgressAction } from '../actions';

export function GoalForm({
  isAdmin,
  parents,
}: {
  isAdmin: boolean;
  parents: { value: string; label: string }[];
}) {
  return (
    <ActionForm action={saveGoalAction} className="space-y-3" resetOnSuccess>
      <Field label="Title" htmlFor="gf-title" required>
        <Input id="gf-title" name="title" required />
      </Field>
      <Field label="Description" htmlFor="gf-desc">
        <Textarea id="gf-desc" name="description" className="min-h-14" />
      </Field>
      {isAdmin ? (
        <Field label="Level" htmlFor="gf-level">
          <Select id="gf-level" name="level" defaultValue="INDIVIDUAL">
            <option value="INDIVIDUAL">Individual (mine)</option>
            <option value="DEPARTMENT">Department</option>
            <option value="COMPANY">Company</option>
          </Select>
        </Field>
      ) : (
        <input type="hidden" name="level" value="INDIVIDUAL" />
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Weight %" htmlFor="gf-weight">
          <Input id="gf-weight" name="weight" type="number" min={0} max={100} />
        </Field>
        <Field label="Due date" htmlFor="gf-due">
          <Input id="gf-due" name="dueDate" type="date" />
        </Field>
      </div>
      {parents.length > 0 ? (
        <Field label="Aligns to" htmlFor="gf-parent">
          <Select id="gf-parent" name="parentId" defaultValue="">
            <option value="">—</option>
            {parents.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <SubmitButton className="w-full">Create goal</SubmitButton>
    </ActionForm>
  );
}

export function GoalProgressForm({ goalId, progress }: { goalId: string; progress: number }) {
  return (
    <ActionForm action={updateGoalProgressAction} className="flex items-center gap-1.5">
      <input type="hidden" name="goalId" value={goalId} />
      <Input
        name="progress"
        type="number"
        min={0}
        max={100}
        defaultValue={progress}
        aria-label="Progress percent"
        className="h-7 w-16 px-2 text-[12px]"
      />
      <SubmitButton variant="ghost" size="sm" className="h-7 px-2 text-[12px]">
        Update
      </SubmitButton>
    </ActionForm>
  );
}
