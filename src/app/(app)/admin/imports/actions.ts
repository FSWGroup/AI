'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requirePermission, AuthzError } from '@/lib/authz';
import { audit } from '@/lib/audit';
import { validateImport, applyImport, type ImportKind, type ImportPreview } from '@/lib/imports';

export interface ImportState {
  error?: string;
  success?: string;
  jobId?: string;
  preview?: ImportPreview;
  kind?: ImportKind;
}

/** Step 1 & 2: upload + validate. Nothing is written to worker tables yet. */
export async function validateImportAction(_prev: ImportState | void, formData: FormData): Promise<ImportState> {
  try {
    const ctx = await requirePermission('imports.admin');
    const file = formData.get('file') as File | null;
    const kind = String(formData.get('kind') ?? 'WORKERS') as ImportKind;
    if (!file || file.size === 0) return { error: 'Choose a CSV file.' };
    if (file.size > 5 * 1024 * 1024) return { error: 'CSV files must be 5 MB or smaller.' };

    const text = await file.text();
    const preview = await validateImport(kind, text);
    if (preview.rows.length === 0) return { error: 'That file has no data rows.' };

    const job = await db.importJob.create({
      data: {
        kind,
        fileName: file.name,
        status: preview.errorCount > 0 && preview.validCount === 0 ? 'FAILED' : 'READY',
        totalRows: preview.rows.length,
        errorRows: preview.errorCount,
        report: preview.rows.filter((r) => r.errors.length).map((r) => ({ row: r.rowNumber, errors: r.errors })),
        createdById: ctx.userId,
      },
    });
    await audit(ctx, 'import.validated', {
      targetType: 'ImportJob',
      targetId: job.id,
      metadata: { kind, total: preview.rows.length, errors: preview.errorCount },
    });
    revalidatePath('/admin/imports');
    return {
      jobId: job.id,
      kind,
      preview,
      success: `${preview.validCount} of ${preview.rows.length} rows are ready to import.`,
    };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    console.error(error);
    return { error: 'Could not read that file. Make sure it is a UTF-8 CSV.' };
  }
}

/** Step 3: confirm & import. Re-validates from the stored file content. */
export async function runImportAction(_prev: ImportState | void, formData: FormData): Promise<ImportState> {
  try {
    const ctx = await requirePermission('imports.admin');
    const jobId = String(formData.get('jobId') ?? '');
    const kind = String(formData.get('kind') ?? 'WORKERS') as ImportKind;
    const payload = String(formData.get('payload') ?? '');
    if (!payload) return { error: 'The preview expired — upload the file again.' };

    const preview = await validateImport(kind, payload);
    await db.importJob.update({ where: { id: jobId }, data: { status: 'IMPORTING' } });

    const report = await applyImport(ctx, kind, preview);
    const imported = report.filter((r) => r.status === 'imported').length;
    const failed = report.filter((r) => r.status === 'failed').length;

    await db.importJob.update({
      where: { id: jobId },
      data: {
        status: failed > 0 ? 'COMPLETED' : 'COMPLETED',
        successRows: imported,
        errorRows: report.length - imported,
        report: report as unknown as object,
      },
    });
    await audit(ctx, 'import.run', {
      targetType: 'ImportJob',
      targetId: jobId,
      metadata: { kind, imported, failed, skipped: report.length - imported - failed },
    });
    revalidatePath('/admin/imports');
    return {
      success: `Imported ${imported} row${imported === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}. Full report below.`,
    };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    console.error(error);
    return { error: 'The import failed. No further rows were applied.' };
  }
}
