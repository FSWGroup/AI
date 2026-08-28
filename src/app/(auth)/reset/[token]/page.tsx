import type { Metadata } from 'next';
import { ResetConfirmForm } from './reset-confirm-form';

export const metadata: Metadata = { title: 'Choose a new password' };

export default async function ResetConfirmPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ResetConfirmForm token={token} />;
}
