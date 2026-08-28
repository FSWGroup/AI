import type { Metadata } from 'next';
import { ActivateForm } from './activate-form';

export const metadata: Metadata = { title: 'Activate your account' };

export default async function ActivatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ActivateForm token={token} />;
}
