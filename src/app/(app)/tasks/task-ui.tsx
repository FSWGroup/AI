'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Field, Input, Select, StatusBadge, Textarea } from '@/components/ui';
import { ActionForm, Drawer, SubmitButton } from '@/components/ui/client';
import { setTaskStatusAction, addTaskCommentAction, createManualTaskAction } from './actions';

export interface TaskDetail {
  id: string;
  title: string;
  description: string | null;
  category: string;
  status: string;
  priority: string;
  dueDate: string | null;
  workerName: string | null;
  workerId: string | null;
  dependsOn: { title: string; status: string } | null;
  comments: { id: string; body: string; author: string; at: string }[];
}

export function TaskDetailDrawer({ task, backHref }: { task: TaskDetail; backHref: string }) {
  const router = useRouter();
  const close = () => router.push(backHref);
  const done = task.status === 'COMPLETED' || task.status === 'CANCELED';

  return (
    <Drawer title={task.title} open onClose={close}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={task.status} />
          <StatusBadge status={task.priority} />
          <Badge tone="gray">{task.category.replace(/_/g, ' ').toLowerCase()}</Badge>
          {task.dueDate ? <span className="text-[13px] text-ink-500">Due {task.dueDate}</span> : null}
        </div>

        {task.workerName && task.workerId ? (
          <p className="text-sm text-ink-600">
            About:{' '}
            <Link href={`/people/${task.workerId}`} className="font-medium text-brand-600 hover:underline">
              {task.workerName}
            </Link>
          </p>
        ) : null}

        {task.description ? <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink-700">{task.description}</p> : null}

        {task.dependsOn && task.dependsOn.status !== 'COMPLETED' ? (
          <p className="rounded-md border border-warn-500/30 bg-warn-100/50 px-3 py-2 text-[13px] text-warn-500">
            Waiting on: {task.dependsOn.title}
          </p>
        ) : null}

        <ActionForm action={setTaskStatusAction} className="flex flex-wrap gap-2">
          <input type="hidden" name="taskId" value={task.id} />
          {!done ? (
            <>
              <SubmitButton name="status" value="COMPLETED" size="sm">
                Mark complete
              </SubmitButton>
              {task.status !== 'IN_PROGRESS' ? (
                <SubmitButton name="status" value="IN_PROGRESS" variant="secondary" size="sm">
                  Start
                </SubmitButton>
              ) : null}
              {task.status !== 'BLOCKED' ? (
                <SubmitButton name="status" value="BLOCKED" variant="secondary" size="sm">
                  Mark blocked
                </SubmitButton>
              ) : null}
            </>
          ) : (
            <SubmitButton name="status" value="OPEN" variant="secondary" size="sm">
              Reopen
            </SubmitButton>
          )}
        </ActionForm>

        <div>
          <h3 className="mb-2 text-[13px] font-semibold text-ink-700">Comments</h3>
          <ul className="space-y-3">
            {task.comments.map((c) => (
              <li key={c.id} className="rounded-md bg-ink-50 px-3 py-2">
                <div className="text-[12px] font-medium text-ink-500">
                  {c.author} · {c.at}
                </div>
                <div className="mt-0.5 text-sm whitespace-pre-wrap text-ink-800">{c.body}</div>
              </li>
            ))}
            {task.comments.length === 0 ? <li className="text-[13px] text-ink-400">No comments yet.</li> : null}
          </ul>
          <ActionForm action={addTaskCommentAction} className="mt-3 space-y-2" resetOnSuccess>
            <input type="hidden" name="taskId" value={task.id} />
            <Textarea name="body" aria-label="Add a comment" placeholder="Add a comment…" className="min-h-16" />
            <SubmitButton variant="secondary" size="sm">
              Comment
            </SubmitButton>
          </ActionForm>
        </div>
      </div>
    </Drawer>
  );
}

export function NewTaskButton({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>New task</Button>
      <Drawer title="New task" open={open} onClose={() => setOpen(false)}>
        <ActionForm action={createManualTaskAction} className="space-y-3" resetOnSuccess>
          <Field label="Title" htmlFor="nt-title" required>
            <Input id="nt-title" name="title" required />
          </Field>
          <Field label="Description" htmlFor="nt-desc">
            <Textarea id="nt-desc" name="description" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category" htmlFor="nt-cat">
              <Select id="nt-cat" name="category">
                {['GENERAL', 'HR', 'ONBOARDING', 'OFFBOARDING', 'COMPLIANCE', 'IT_ACCESS', 'EQUIPMENT', 'TRAINING', 'DOCUMENT'].map((c) => (
                  <option key={c} value={c}>
                    {c.replace(/_/g, ' ').toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Priority" htmlFor="nt-pri">
              <Select id="nt-pri" name="priority" defaultValue="NORMAL">
                {['LOW', 'NORMAL', 'HIGH', 'CRITICAL'].map((p) => (
                  <option key={p} value={p}>
                    {p.toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Due date" htmlFor="nt-due">
              <Input id="nt-due" name="dueDate" type="date" />
            </Field>
            {isAdmin ? (
              <Field label="Assign to" htmlFor="nt-assignee">
                <Select id="nt-assignee" name="assignee" defaultValue="me">
                  <option value="me">Myself</option>
                  <option value="role:HR_ADMIN">HR queue</option>
                  <option value="role:IT_ADMIN">IT queue</option>
                  <option value="role:FINANCE">Finance queue</option>
                </Select>
              </Field>
            ) : (
              <input type="hidden" name="assignee" value="me" />
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Close
            </Button>
            <SubmitButton>Create task</SubmitButton>
          </div>
        </ActionForm>
      </Drawer>
    </>
  );
}
