'use client';

import { Field, Input, Select } from '@/components/ui';
import { ActionForm, SubmitButton, ConfirmSubmit } from '@/components/ui/client';
import { saveTemplateItemAction, deleteTemplateItemAction } from '../../actions';

export function TemplateItemForm({ templateId, nextOrder }: { templateId: string; nextOrder: number }) {
  return (
    <ActionForm action={saveTemplateItemAction} className="grid grid-cols-2 gap-3 sm:grid-cols-6" resetOnSuccess>
      <input type="hidden" name="templateId" value={templateId} />
      <Field label="Task title" htmlFor="ti-title" required className="col-span-2">
        <Input id="ti-title" name="title" required />
      </Field>
      <Field label="Owner" htmlFor="ti-owner">
        <Select id="ti-owner" name="ownerKind">
          {['HR', 'EMPLOYEE', 'MANAGER', 'IT', 'FINANCE'].map((o) => (
            <option key={o} value={o}>
              {o.toLowerCase()}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Category" htmlFor="ti-cat">
        <Select id="ti-cat" name="category">
          {['ONBOARDING', 'OFFBOARDING', 'COMPLIANCE', 'IT_ACCESS', 'EQUIPMENT', 'TRAINING', 'DOCUMENT', 'HR'].map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, ' ').toLowerCase()}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Due offset (days)" htmlFor="ti-due">
        <Input id="ti-due" name="dueOffsetDays" type="number" defaultValue={0} />
      </Field>
      <Field label="Order" htmlFor="ti-order">
        <Input id="ti-order" name="order" type="number" defaultValue={nextOrder} />
      </Field>
      <div className="col-span-2 flex items-end sm:col-span-6">
        <SubmitButton variant="secondary" size="sm">
          Add checklist item
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function DeleteItemButton({ itemId }: { itemId: string }) {
  return (
    <ConfirmSubmit
      action={deleteTemplateItemAction}
      title="Remove this checklist item?"
      description="Existing checklists keep their tasks; only future runs change."
      confirmLabel="Remove"
      variant="dangerGhost"
      hiddenFields={{ itemId }}
    >
      Remove
    </ConfirmSubmit>
  );
}
