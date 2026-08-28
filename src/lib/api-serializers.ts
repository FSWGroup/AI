import 'server-only';

/**
 * What the read API is allowed to return.
 *
 * The single most dangerous thing about a machine API is that it has no
 * screen, so an over-broad field never gets noticed. These serializers are
 * explicit allowlists, never spreads of a Prisma row — a field reaches the
 * outside world only because somebody named it here.
 *
 * Deliberately absent from every shape below: date of birth, home address,
 * personal email, personal phone, compensation, bank details, any encrypted
 * identifier, HR cases, performance ratings, and termination reasons.
 */

export interface ApiWorker {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  workEmail: string | null;
  status: string;
  workerType: string;
  title: string | null;
  department: string | null;
  location: string | null;
  legalEntity: string | null;
  managerId: string | null;
  hireDate: string | null;
  country: string;
}

export function serializeWorker(worker: {
  id: string;
  employeeNumber: string;
  legalFirstName: string;
  preferredName: string | null;
  lastName: string;
  workEmail: string | null;
  status: string;
  workerType: string;
  country: string;
  hireDate: Date | null;
  employments: {
    title: string;
    managerId: string | null;
    department: { name: string } | null;
    location: { name: string } | null;
    legalEntity: { name: string } | null;
  }[];
}): ApiWorker {
  const employment = worker.employments[0] ?? null;
  return {
    id: worker.id,
    employeeNumber: worker.employeeNumber,
    firstName: worker.preferredName || worker.legalFirstName,
    lastName: worker.lastName,
    workEmail: worker.workEmail,
    status: worker.status,
    workerType: worker.workerType,
    title: employment?.title ?? null,
    department: employment?.department?.name ?? null,
    location: employment?.location?.name ?? null,
    legalEntity: employment?.legalEntity?.name ?? null,
    managerId: employment?.managerId ?? null,
    hireDate: worker.hireDate ? worker.hireDate.toISOString().slice(0, 10) : null,
    country: worker.country,
  };
}

/** The exhaustive list of keys a worker record may expose. Asserted in tests. */
export const API_WORKER_FIELDS = [
  'id', 'employeeNumber', 'firstName', 'lastName', 'workEmail', 'status', 'workerType',
  'title', 'department', 'location', 'legalEntity', 'managerId', 'hireDate', 'country',
] as const;
