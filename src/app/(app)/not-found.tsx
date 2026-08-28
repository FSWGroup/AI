import { ButtonLink, Card, CardBody } from '@/components/ui';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg pt-16">
      <Card>
        <CardBody className="py-10 text-center">
          <h1 className="text-lg font-semibold text-ink-900">Page not found</h1>
          <p className="mt-2 text-sm text-ink-500">
            This page doesn&apos;t exist, or you don&apos;t have access to see it.
          </p>
          <div className="mt-5">
            <ButtonLink variant="secondary" href="/">
              Back to home
            </ButtonLink>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
