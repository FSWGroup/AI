'use client';

import { Field, Input, Select } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/client';
import { uploadDocumentAction } from '../actions';

export function UploadForm({
  workers,
  preselectWorkerId,
  documentId,
}: {
  workers: { value: string; label: string }[];
  preselectWorkerId?: string;
  documentId?: string;
}) {
  return (
    <ActionForm action={uploadDocumentAction} className="space-y-3">
      {documentId ? <input type="hidden" name="documentId" value={documentId} /> : null}
      <Field label="File (PDF, PNG, JPG, DOCX, XLSX, CSV — max 15 MB)" htmlFor="up-file" required>
        <input
          id="up-file"
          name="file"
          type="file"
          required
          accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,.csv,.txt"
          className="block w-full text-sm text-ink-700 file:mr-3 file:rounded-md file:border-0 file:bg-brand-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-700"
        />
      </Field>
      {!documentId ? (
        <>
          <Field label="Title" htmlFor="up-title" hint="Defaults to the file name.">
            <Input id="up-title" name="title" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category" htmlFor="up-cat">
              <Select id="up-cat" name="category">
                {['OFFER', 'EMPLOYMENT_AGREEMENT', 'CONTRACTOR_AGREEMENT', 'TAX_FORM', 'I9', 'HANDBOOK', 'POLICY', 'REVIEW', 'DISCIPLINARY', 'CERTIFICATION', 'TRAINING', 'COMPENSATION', 'BENEFITS', 'ID_DOCUMENT', 'OTHER'].map((c) => (
                  <option key={c} value={c}>
                    {c.replace(/_/g, ' ').toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Classification" htmlFor="up-class">
              <Select id="up-class" name="classification" defaultValue="CONFIDENTIAL">
                <option value="PUBLIC_INTERNAL">Public internal</option>
                <option value="INTERNAL">Internal</option>
                <option value="CONFIDENTIAL">Confidential</option>
                <option value="HIGHLY_RESTRICTED">Highly restricted</option>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Worker (blank = company-wide)" htmlFor="up-worker">
              <Select id="up-worker" name="workerId" defaultValue={preselectWorkerId ?? ''}>
                <option value="">Company-wide</option>
                {workers.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Expires (work authorization, certificates…)" htmlFor="up-expires">
              <Input id="up-expires" name="expiresAt" type="date" />
            </Field>
          </div>
        </>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Approved by (for legal templates)" htmlFor="up-approved">
          <Input id="up-approved" name="approvedBy" placeholder="e.g. outside counsel, HR Director" />
        </Field>
        <Field label="Effective date" htmlFor="up-effective">
          <Input id="up-effective" name="effectiveAt" type="date" />
        </Field>
      </div>
      {!documentId ? (
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" name="requiresSignature" className="h-4 w-4 rounded border-ink-300" />
          Requires signature / acknowledgment from the worker
        </label>
      ) : null}
      <SubmitButton pendingLabel="Uploading…">{documentId ? 'Upload new version' : 'Upload document'}</SubmitButton>
    </ActionForm>
  );
}
