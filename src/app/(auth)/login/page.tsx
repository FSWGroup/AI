import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>;
}) {
  const session = await getSession();
  if (session && (!session.user.mfaEnabled || session.mfaPassed)) redirect('/');
  const params = await searchParams;
  return <LoginForm passwordWasReset={params.reset === '1'} />;
}
