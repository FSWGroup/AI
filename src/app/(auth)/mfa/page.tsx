import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { MfaForm } from './mfa-form';

export const metadata: Metadata = { title: 'Two-factor authentication' };

export default async function MfaPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!session.user.mfaEnabled || session.mfaPassed) redirect('/');
  return <MfaForm />;
}
