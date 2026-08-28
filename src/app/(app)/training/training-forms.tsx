'use client';

import { Field, Input, Select, Textarea } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/client';
import { saveCourseAction, assignTrainingAction, completeTrainingAction } from './actions';

export function CourseForm() {
  return (
    <ActionForm action={saveCourseAction} className="space-y-3" resetOnSuccess>
      <Field label="Title" htmlFor="tc-title" required>
        <Input id="tc-title" name="title" required />
      </Field>
      <Field label="Category" htmlFor="tc-cat">
        <Select id="tc-cat" name="category">
          {['SAFETY', 'CYBERSECURITY', 'HARASSMENT_PREVENTION', 'PRODUCT', 'MANAGEMENT', 'ERP', 'CRM', 'SALES', 'SOP', 'OTHER'].map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, ' ').toLowerCase()}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Content URL (video, LMS, document)" htmlFor="tc-url">
        <Input id="tc-url" name="contentUrl" type="url" />
      </Field>
      <Field label="Description" htmlFor="tc-desc">
        <Textarea id="tc-desc" name="description" className="min-h-14" />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Days to complete" htmlFor="tc-due">
          <Input id="tc-due" name="dueDays" type="number" defaultValue={30} />
        </Field>
        <Field label="Duration (min)" htmlFor="tc-dur">
          <Input id="tc-dur" name="durationMin" type="number" />
        </Field>
        <Field label="Recurs (months)" htmlFor="tc-rec">
          <Input id="tc-rec" name="recurrenceMonths" type="number" placeholder="blank = once" />
        </Field>
      </div>
      <SubmitButton variant="secondary" className="w-full">
        Create course
      </SubmitButton>
    </ActionForm>
  );
}

export function AssignForm({ courseId, workers }: { courseId: string; workers: { value: string; label: string }[] }) {
  return (
    <ActionForm action={assignTrainingAction} className="flex items-center gap-1.5">
      <input type="hidden" name="courseId" value={courseId} />
      <Select name="target" aria-label="Assign to" className="h-7 w-36 py-0 text-[12px]">
        <option value="ALL">Everyone</option>
        <option value="RULES">Matching rules</option>
        {workers.map((w) => (
          <option key={w.value} value={w.value}>
            {w.label}
          </option>
        ))}
      </Select>
      <SubmitButton variant="secondary" size="sm" className="h-7 px-2 text-[12px]">
        Assign
      </SubmitButton>
    </ActionForm>
  );
}

export function CompleteButtons({ assignmentId, status }: { assignmentId: string; status: string }) {
  return (
    <ActionForm action={completeTrainingAction} className="flex items-center gap-1.5">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      {status === 'ASSIGNED' ? (
        <SubmitButton name="status" value="IN_PROGRESS" variant="ghost" size="sm" className="h-7 px-2 text-[12px]">
          Start
        </SubmitButton>
      ) : null}
      <SubmitButton name="status" value="COMPLETED" variant="secondary" size="sm" className="h-7 px-2 text-[12px]">
        Mark complete
      </SubmitButton>
    </ActionForm>
  );
}
