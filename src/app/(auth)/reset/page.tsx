import type { Metadata } from 'next';
import { ResetRequestForm } from './reset-request-form';

export const metadata: Metadata = { title: 'Reset password' };

export default function ResetPage() {
  return <ResetRequestForm />;
}
