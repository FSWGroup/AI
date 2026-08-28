import type { PrismaClient } from '../src/generated/prisma/client';

/**
 * Demo data: fictional workers across every persona (§60), plus onboarding
 * templates, PTO policies, sample recruiting pipeline, goals, reviews,
 * benefits plans, equipment, software catalog, workflows and compliance
 * rules — so every module is reviewable immediately after setup.
 *
 * Everything created here is clearly labeled (Worker.isDemo = true, "[DEMO]"
 * markers on templates where visible). No real identifiers are used.
 */

interface SeedContext {
  orgId: string;
  entities: { fsw: string; vlv: string };
  departments: Map<string, string>;
  locations: { exton: string; remotePh: string };
  adminUserId: string;
  passwordHash: string;
}

export async function seedDemoData(db: PrismaClient, ctx: SeedContext) {
  const existing = await db.worker.count();
  if (existing > 0) {
    console.log('Demo data already present — skipping.');
    return;
  }
  console.log('Seeding demo workers…');

  const year = new Date().getUTCFullYear();
  const d = (s: string) => new Date(s);

  const roleId = async (key: string) => (await db.role.findUniqueOrThrow({ where: { key } })).id;
  const roles = {
    hr: await roleId('HR_ADMIN'),
    exec: await roleId('EXECUTIVE'),
    manager: await roleId('MANAGER'),
    employee: await roleId('EMPLOYEE'),
    contractor: await roleId('CONTRACTOR'),
    finance: await roleId('FINANCE'),
    it: await roleId('IT_ADMIN'),
    recruiter: await roleId('RECRUITER'),
  };

  let counter = 0;
  async function makeWorker(opts: {
    first: string;
    last: string;
    preferred?: string;
    email: string;
    workerType: 'EMPLOYEE' | 'CONTRACTOR';
    status?: 'ACTIVE' | 'PRE_START' | 'ONBOARDING' | 'TERMINATED';
    country?: string;
    entityId: string;
    dept: string;
    title: string;
    jobFamily?: string;
    jobLevel?: string;
    managerId?: string | null;
    locationId?: string;
    hireDate: string;
    dob?: string;
    payBasis?: 'SALARY' | 'HOURLY';
    workMode?: 'ONSITE' | 'REMOTE' | 'HYBRID';
    workState?: string | null;
    flsa?: 'EXEMPT' | 'NON_EXEMPT';
    amount: number;
    rateType: 'ANNUAL' | 'HOURLY' | 'MONTHLY';
    currency?: string;
    roleIds: string[];
    timezone?: string;
    terminated?: { date: string; reason: string; voluntary: boolean };
  }) {
    counter += 1;
    const user = await db.user.create({
      data: {
        email: opts.email,
        passwordHash: ctx.passwordHash,
        status: 'ACTIVE',
        roles: { create: opts.roleIds.map((rid) => ({ roleId: rid })) },
      },
    });
    const worker = await db.worker.create({
      data: {
        employeeNumber: `FSW-${String(counter).padStart(4, '0')}`,
        userId: user.id,
        legalFirstName: opts.first,
        preferredName: opts.preferred ?? null,
        lastName: opts.last,
        workEmail: opts.email,
        personalEmail: `${opts.first.toLowerCase()}.demo@example.com`,
        phone: `+1 555 01${String(counter).padStart(2, '0')}`,
        dateOfBirth: opts.dob ? d(opts.dob) : d(`${1970 + (counter % 25)}-0${(counter % 9) + 1}-1${counter % 9}`),
        homeStreet: opts.country === 'PH' ? `${counter} Mabini Street` : `${counter} Meadow Lane`,
        homeCity: opts.country === 'PH' ? 'Quezon City' : 'Exton',
        homeState: opts.country === 'PH' ? 'NCR' : 'PA',
        homePostal: opts.country === 'PH' ? '1100' : '19341',
        homeCountry: opts.country ?? 'US',
        workerType: opts.workerType,
        status: opts.status ?? 'ACTIVE',
        country: opts.country ?? 'US',
        timezone: opts.timezone ?? (opts.country === 'PH' ? 'Asia/Manila' : 'America/New_York'),
        localCurrency: opts.currency ?? (opts.country === 'PH' ? 'PHP' : 'USD'),
        engagementModel: opts.workerType === 'CONTRACTOR' ? 'DIRECT' : null,
        hireDate: d(opts.hireDate),
        originalHireDate: d(opts.hireDate),
        seniorityDate: d(opts.hireDate),
        isDemo: true,
        ...(opts.terminated
          ? {
              status: 'TERMINATED',
              terminationDate: d(opts.terminated.date),
              terminationReason: opts.terminated.reason,
              voluntaryTermination: opts.terminated.voluntary,
              rehireEligible: true,
            }
          : {}),
        employments: {
          create: {
            legalEntityId: opts.entityId,
            departmentId: ctx.departments.get(opts.dept)!,
            locationId: opts.locationId ?? (opts.country === 'PH' ? ctx.locations.remotePh : ctx.locations.exton),
            managerId: opts.managerId ?? null,
            title: opts.title,
            jobFamily: opts.jobFamily ?? opts.dept,
            jobLevel: opts.jobLevel ?? 'IC2',
            employmentBasis: 'FULL_TIME',
            flsaStatus: opts.country === 'PH' ? null : (opts.flsa ?? 'EXEMPT'),
            payBasis: opts.payBasis ?? 'SALARY',
            workMode: opts.workMode ?? 'ONSITE',
            workState: opts.workState === undefined ? (opts.country === 'PH' ? null : 'PA') : opts.workState,
            effectiveFrom: d(opts.hireDate),
            changeReason: 'HIRE',
            ...(opts.terminated ? { effectiveTo: d(opts.terminated.date) } : {}),
          },
        },
        compensations: {
          create: {
            amount: opts.amount,
            currency: opts.currency ?? (opts.country === 'PH' ? 'PHP' : 'USD'),
            rateType: opts.rateType,
            payFrequency: opts.rateType === 'ANNUAL' ? 'SEMIMONTHLY' : opts.rateType === 'MONTHLY' ? 'MONTHLY' : 'BIWEEKLY',
            reason: 'HIRE',
            effectiveFrom: d(opts.hireDate),
          },
        },
        emergencyContacts: {
          create: {
            name: `Pat ${opts.last}`,
            relationship: 'Spouse',
            phone: '+1 555 0999',
          },
        },
      },
    });
    await db.timelineEvent.create({
      data: {
        workerId: worker.id,
        kind: 'HIRE',
        title: `Hired as ${opts.title}`,
        visibility: 'MANAGER',
        occurredAt: d(opts.hireDate),
      },
    });
    return worker;
  }

  // --- Leadership chain ----------------------------------------------------
  const ceo = await makeWorker({
    first: 'Graham', last: 'Wellstone', email: 'graham.wellstone@fswelsford.com',
    workerType: 'EMPLOYEE', entityId: ctx.entities.fsw, dept: 'Executive', title: 'Chief Executive Officer',
    jobFamily: 'Executive', jobLevel: 'E1', hireDate: `${year - 12}-03-01`, amount: 340000, rateType: 'ANNUAL',
    roleIds: [roles.exec, roles.manager], workMode: 'ONSITE',
  });
  const hrAdmin = await makeWorker({
    first: 'Dana', last: 'Reyes', email: 'dana.reyes@fswelsford.com',
    workerType: 'EMPLOYEE', entityId: ctx.entities.fsw, dept: 'Human Resources', title: 'Head of People',
    jobFamily: 'People', jobLevel: 'M2', managerId: ceo.id, hireDate: `${year - 6}-05-11`, amount: 142000,
    rateType: 'ANNUAL', roleIds: [roles.hr, roles.manager, roles.recruiter], workMode: 'HYBRID',
  });
  const opsLead = await makeWorker({
    first: 'Miguel', last: 'Torres', email: 'miguel.torres@fswelsford.com',
    workerType: 'EMPLOYEE', entityId: ctx.entities.fsw, dept: 'Operations', title: 'VP Operations',
    jobFamily: 'Operations', jobLevel: 'M3', managerId: ceo.id, hireDate: `${year - 9}-02-17`, amount: 188000,
    rateType: 'ANNUAL', roleIds: [roles.manager, roles.employee], workMode: 'ONSITE',
  });
  const salesLead = await makeWorker({
    first: 'Priya', last: 'Natarajan', email: 'priya.natarajan@fswelsford.com',
    workerType: 'EMPLOYEE', entityId: ctx.entities.vlv, dept: 'Sales', title: 'Director of Sales',
    jobFamily: 'Sales', jobLevel: 'M2', managerId: ceo.id, hireDate: `${year - 5}-08-03`, amount: 165000,
    rateType: 'ANNUAL', roleIds: [roles.manager, roles.employee], workMode: 'HYBRID',
  });
  const finLead = await makeWorker({
    first: 'Olivia', last: 'Chen', email: 'olivia.chen@fswelsford.com',
    workerType: 'EMPLOYEE', entityId: ctx.entities.fsw, dept: 'Accounting & Finance', title: 'Controller',
    jobFamily: 'Finance', jobLevel: 'M2', managerId: ceo.id, hireDate: `${year - 7}-10-20`, amount: 158000,
    rateType: 'ANNUAL', roleIds: [roles.finance, roles.manager], workMode: 'ONSITE',
  });
  const itAdmin = await makeWorker({
    first: 'Sam', last: 'Okafor', email: 'sam.okafor@fswelsford.com',
    workerType: 'EMPLOYEE', entityId: ctx.entities.fsw, dept: 'IT', title: 'IT Administrator',
    jobFamily: 'IT', jobLevel: 'IC3', managerId: opsLead.id, hireDate: `${year - 4}-01-09`, amount: 96000,
    rateType: 'ANNUAL', roleIds: [roles.it], workMode: 'ONSITE',
  });

  // --- Individual contributors --------------------------------------------
  const salesperson = await makeWorker({
    first: 'Tyler', last: 'Brooks', email: 'tyler.brooks@fswelsford.com',
    workerType: 'EMPLOYEE', entityId: ctx.entities.vlv, dept: 'Sales', title: 'Account Executive',
    jobFamily: 'Sales', jobLevel: 'IC3', managerId: salesLead.id, hireDate: `${year - 3}-06-15`, amount: 78000,
    rateType: 'ANNUAL', roleIds: [roles.employee], workMode: 'HYBRID',
  });
  const warehouse = await makeWorker({
    first: 'Rosa', last: 'Delgado', email: 'rosa.delgado@fswelsford.com',
    workerType: 'EMPLOYEE', entityId: ctx.entities.fsw, dept: 'Warehouse', title: 'Warehouse Associate',
    jobFamily: 'Warehouse', jobLevel: 'IC1', managerId: opsLead.id, hireDate: `${year - 2}-04-01`,
    payBasis: 'HOURLY', flsa: 'NON_EXEMPT', amount: 21.5, rateType: 'HOURLY', roleIds: [roles.employee],
  });
  const engineer = await makeWorker({
    first: 'Wesley', last: 'Kim', preferred: 'Wes', email: 'wes.kim@fswelsford.com',
    workerType: 'EMPLOYEE', entityId: ctx.entities.fsw, dept: 'Application Engineering', title: 'Application Engineer',
    jobFamily: 'Engineering', jobLevel: 'IC3', managerId: opsLead.id, hireDate: `${year - 1}-09-08`, amount: 92000,
    rateType: 'ANNUAL', roleIds: [roles.employee], workMode: 'HYBRID',
  });
  const remoteUs = await makeWorker({
    first: 'Jennifer', last: 'Hale', preferred: 'Jen', email: 'jen.hale@fswelsford.com',
    workerType: 'EMPLOYEE', entityId: ctx.entities.vlv, dept: 'Customer Service & E-Commerce', title: 'E-Commerce Specialist',
    jobFamily: 'CX', jobLevel: 'IC2', managerId: salesLead.id, hireDate: `${year - 2}-11-30`, amount: 61000,
    rateType: 'ANNUAL', roleIds: [roles.employee], workMode: 'REMOTE', workState: 'OH',
  });

  // --- Philippines team ----------------------------------------------------
  const phEmployee = await makeWorker({
    first: 'Maricel', last: 'Santos', email: 'maricel.santos@fswelsford.com',
    workerType: 'EMPLOYEE', country: 'PH', entityId: ctx.entities.fsw, dept: 'Customer Service & E-Commerce',
    title: 'Customer Service Team Lead', jobFamily: 'CX', jobLevel: 'IC4', managerId: salesLead.id,
    hireDate: `${year - 3}-02-14`, amount: 65000, rateType: 'MONTHLY', currency: 'PHP',
    roleIds: [roles.employee, roles.manager], workMode: 'REMOTE',
  });
  const phContractor = await makeWorker({
    first: 'Joshua', last: 'Villanueva', preferred: 'JV', email: 'joshua.villanueva@fswelsford.com',
    workerType: 'CONTRACTOR', country: 'PH', entityId: ctx.entities.fsw, dept: 'Customer Service & E-Commerce',
    title: 'E-Commerce Listings Specialist', jobFamily: 'CX', jobLevel: 'IC2', managerId: phEmployee.id,
    hireDate: `${year - 1}-07-01`, amount: 55000, rateType: 'MONTHLY', currency: 'PHP',
    roleIds: [roles.contractor], workMode: 'REMOTE',
  });
  await db.contractorProfile.create({
    data: {
      workerId: phContractor.id,
      isBusiness: false,
      contractStart: d(`${year - 1}-07-01`),
      contractEnd: d(`${year}-12-31`),
      paymentTerms: 'NET_15',
      paymentMethod: 'WISE',
      internalOwnerId: phEmployee.id,
      w8Status: 'RECEIVED',
      w9Status: 'NOT_REQUIRED',
      is1099Eligible: false,
      notes: '[DEMO] Independent contractor engagement, W-8BEN on file.',
    },
  });

  // --- US contractor -------------------------------------------------------
  const usContractor = await makeWorker({
    first: 'Frank', last: 'Miller', email: 'frank.miller@millercontrols.example.com',
    workerType: 'CONTRACTOR', entityId: ctx.entities.vlv, dept: 'Application Engineering',
    title: 'Controls Consultant', jobFamily: 'Engineering', jobLevel: 'IC4', managerId: opsLead.id,
    hireDate: `${year}-01-15`, amount: 125, rateType: 'HOURLY', roleIds: [roles.contractor], workMode: 'REMOTE', workState: 'NJ',
  });
  await db.contractorProfile.create({
    data: {
      workerId: usContractor.id,
      isBusiness: true,
      businessName: 'Miller Controls LLC',
      contractStart: d(`${year}-01-15`),
      contractEnd: d(`${year}-11-15`),
      paymentTerms: 'NET_30',
      paymentMethod: 'ACH',
      internalOwnerId: opsLead.id,
      w9Status: 'RECEIVED',
      is1099Eligible: true,
      notes: '[DEMO] SOW covers valve automation projects.',
    },
  });

  // --- Terminated employee --------------------------------------------------
  await makeWorker({
    first: 'Derek', last: 'Palmer', email: 'derek.palmer@fswelsford.com',
    workerType: 'EMPLOYEE', entityId: ctx.entities.fsw, dept: 'Warehouse', title: 'Warehouse Associate',
    jobFamily: 'Warehouse', jobLevel: 'IC1', managerId: opsLead.id, hireDate: `${year - 4}-03-22`,
    payBasis: 'HOURLY', flsa: 'NON_EXEMPT', amount: 19.75, rateType: 'HOURLY', roleIds: [roles.employee],
    terminated: { date: `${year - 1}-08-30`, reason: 'Relocated out of state', voluntary: true },
  });

  // --- New hire mid-onboarding ----------------------------------------------
  const newHire = await makeWorker({
    first: 'Alexis', last: 'Grant', email: 'alexis.grant@fswelsford.com',
    workerType: 'EMPLOYEE', status: 'ONBOARDING', entityId: ctx.entities.fsw, dept: 'Sales',
    title: 'Inside Sales Representative', jobFamily: 'Sales', jobLevel: 'IC2', managerId: salesLead.id,
    hireDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10), amount: 58000,
    rateType: 'ANNUAL', roleIds: [roles.employee],
  });

  // Link the primary admin user to the HR worker for a nicer demo experience
  await db.worker.update({ where: { id: hrAdmin.id }, data: {} });

  console.log('Seeding PTO policies…');
  const vacation = await db.ptoPolicy.create({
    data: {
      name: 'US Vacation', leaveType: 'VACATION', country: 'US', accrualMethod: 'MONTHLY',
      hoursPerYear: 120, carryoverCapHours: 40, maxBalanceHours: 160, waitingPeriodDays: 0,
    },
  });
  const sick = await db.ptoPolicy.create({
    data: { name: 'US Sick', leaveType: 'SICK', country: 'US', accrualMethod: 'ANNUAL_GRANT', hoursPerYear: 48 },
  });
  const phLeave = await db.ptoPolicy.create({
    data: {
      name: 'PH Service Incentive & Company Leave', leaveType: 'VACATION', country: 'PH',
      accrualMethod: 'ANNUAL_GRANT', hoursPerYear: 120,
    },
  });

  const usWorkers = [ceo, hrAdmin, opsLead, salesLead, finLead, itAdmin, salesperson, warehouse, engineer, remoteUs, newHire];
  for (const w of usWorkers) {
    for (const p of [vacation, sick]) {
      await db.ptoPolicyAssignment.create({ data: { workerId: w.id, policyId: p.id } });
    }
    await db.ptoTransaction.create({
      data: { workerId: w.id, policyId: vacation.id, kind: 'GRANT', hours: 60, effectiveDate: new Date(), note: 'Opening balance (demo)' },
    });
    await db.ptoTransaction.create({
      data: { workerId: w.id, policyId: sick.id, kind: 'GRANT', hours: 48, effectiveDate: new Date(), note: 'Annual grant (demo)' },
    });
  }
  for (const w of [phEmployee]) {
    await db.ptoPolicyAssignment.create({ data: { workerId: w.id, policyId: phLeave.id } });
    await db.ptoTransaction.create({
      data: { workerId: w.id, policyId: phLeave.id, kind: 'GRANT', hours: 120, effectiveDate: new Date(), note: 'Annual grant (demo)' },
    });
  }

  // A pending PTO request for the manager demo
  await db.ptoRequest.create({
    data: {
      workerId: salesperson.id,
      policyId: vacation.id,
      startDate: new Date(Date.now() + 14 * 86_400_000),
      endDate: new Date(Date.now() + 16 * 86_400_000),
      hours: 24,
      note: 'Family trip',
      status: 'PENDING',
    },
  });

  console.log('Seeding onboarding templates…');
  const usOnboarding = await db.lifecycleTemplate.create({
    data: {
      kind: 'ONBOARDING',
      name: 'US Employee Onboarding',
      description: 'Default onboarding for U.S. W-2 employees.',
      isDefault: true,
      conditions: { countries: ['US'], workerTypes: ['EMPLOYEE'] },
      items: {
        create: [
          { order: 1, title: 'Send offer letter & employment agreement', ownerKind: 'HR', dueOffsetDays: -10, category: 'DOCUMENT' },
          { order: 2, title: 'Create worker profile & send welcome email', ownerKind: 'HR', dueOffsetDays: -7, category: 'ONBOARDING' },
          { order: 3, title: 'Employee: complete personal information', ownerKind: 'EMPLOYEE', dueOffsetDays: -5, category: 'ONBOARDING', description: 'Confirm address, emergency contact and direct deposit details in FSW People.' },
          { order: 4, title: 'Form I-9 Section 1 (employee)', ownerKind: 'EMPLOYEE', dueOffsetDays: 0, category: 'COMPLIANCE', description: 'Complete by first day of work. Tracked here; verify per USCIS instructions.' },
          { order: 5, title: 'Form I-9 Section 2 verification (HR)', ownerKind: 'HR', dueOffsetDays: 3, category: 'COMPLIANCE', description: 'Within 3 business days of start. Record documents examined.', dependsOnOrder: 4 },
          { order: 6, title: 'Collect Form W-4 + PA state withholding', ownerKind: 'HR', dueOffsetDays: 0, category: 'COMPLIANCE' },
          { order: 7, title: 'Handbook & policy acknowledgments', ownerKind: 'EMPLOYEE', dueOffsetDays: 3, category: 'DOCUMENT' },
          { order: 8, title: 'Provision Microsoft 365 account & email', ownerKind: 'IT', dueOffsetDays: -2, category: 'IT_ACCESS' },
          { order: 9, title: 'Assign laptop and equipment', ownerKind: 'IT', dueOffsetDays: -1, category: 'EQUIPMENT' },
          { order: 10, title: 'Manager: first-day welcome & workspace tour', ownerKind: 'MANAGER', dueOffsetDays: 0, category: 'ONBOARDING' },
          { order: 11, title: 'Assign required safety & security training', ownerKind: 'HR', dueOffsetDays: 1, category: 'TRAINING' },
          { order: 12, title: 'Manager: 30-day check-in', ownerKind: 'MANAGER', dueOffsetDays: 30, category: 'ONBOARDING' },
          { order: 13, title: 'Manager: 60-day check-in', ownerKind: 'MANAGER', dueOffsetDays: 60, category: 'ONBOARDING' },
          { order: 14, title: 'Manager: 90-day check-in & probation review', ownerKind: 'MANAGER', dueOffsetDays: 90, category: 'ONBOARDING' },
        ],
      },
    },
  });
  await db.lifecycleTemplate.create({
    data: {
      kind: 'ONBOARDING',
      name: 'Philippines Contractor Onboarding',
      description: 'Onboarding for independent contractors based in the Philippines.',
      conditions: { countries: ['PH'], workerTypes: ['CONTRACTOR'] },
      items: {
        create: [
          { order: 1, title: 'Countersigned contractor agreement on file', ownerKind: 'HR', dueOffsetDays: -7, category: 'DOCUMENT' },
          { order: 2, title: 'Collect W-8BEN (foreign person US tax form)', ownerKind: 'HR', dueOffsetDays: -5, category: 'COMPLIANCE', description: 'Confirm the correct form with the payroll/tax provider.' },
          { order: 3, title: 'Contractor: confirm payment details & schedule', ownerKind: 'EMPLOYEE', dueOffsetDays: -3, category: 'ONBOARDING' },
          { order: 4, title: 'Data privacy notice & consent acknowledgment', ownerKind: 'EMPLOYEE', dueOffsetDays: -3, category: 'COMPLIANCE', description: 'Philippine Data Privacy Act notice.' },
          { order: 5, title: 'Provision limited app access (no employee-only systems)', ownerKind: 'IT', dueOffsetDays: -1, category: 'IT_ACCESS' },
          { order: 6, title: 'Manager: kickoff call & working schedule', ownerKind: 'MANAGER', dueOffsetDays: 0, category: 'ONBOARDING' },
        ],
      },
    },
  });
  await db.lifecycleTemplate.create({
    data: {
      kind: 'OFFBOARDING',
      name: 'Standard Offboarding',
      description: 'Default offboarding for all workers.',
      isDefault: true,
      items: {
        create: [
          { order: 1, title: 'Manager notified & transition plan started', ownerKind: 'MANAGER', dueOffsetDays: -10, category: 'OFFBOARDING' },
          { order: 2, title: 'Knowledge transfer & files handover', ownerKind: 'EMPLOYEE', dueOffsetDays: -3, category: 'OFFBOARDING' },
          { order: 3, title: 'Notify payroll of final pay date', ownerKind: 'FINANCE', dueOffsetDays: -5, category: 'OFFBOARDING' },
          { order: 4, title: 'Revoke all application access', ownerKind: 'IT', dueOffsetDays: 0, category: 'IT_ACCESS', description: 'Disable SSO, email forwarding rules per policy, revoke every grant in the access catalog.' },
          { order: 5, title: 'Collect equipment (laptop, badge, keys)', ownerKind: 'IT', dueOffsetDays: 0, category: 'EQUIPMENT' },
          { order: 6, title: 'Benefits termination / COBRA packet (US employees)', ownerKind: 'HR', dueOffsetDays: 1, category: 'COMPLIANCE', conditions: { countries: ['US'], workerTypes: ['EMPLOYEE'] } },
          { order: 7, title: 'Exit interview', ownerKind: 'HR', dueOffsetDays: -1, category: 'OFFBOARDING' },
          { order: 8, title: 'Final documents & record retention schedule set', ownerKind: 'HR', dueOffsetDays: 3, category: 'COMPLIANCE' },
        ],
      },
    },
  });

  // Start onboarding for the new hire
  const { startLifecycleSeed } = await import('./seed-lifecycle');
  await startLifecycleSeed(db, newHire.id, usOnboarding.id, newHire.hireDate ?? new Date());

  console.log('Seeding recruiting pipeline…');
  const stages = ['Applied', 'Recruiter Review', 'Phone Screen', 'Hiring Manager', 'Interview', 'Offer', 'Hired'];
  const stageIds: string[] = [];
  for (let i = 0; i < stages.length; i++) {
    const s = await db.pipelineStage.upsert({
      where: { name: stages[i] },
      create: { name: stages[i], order: i + 1, isTerminal: stages[i] === 'Hired' },
      update: {},
    });
    stageIds.push(s.id);
  }
  const req = await db.jobRequisition.create({
    data: {
      title: 'Warehouse Team Lead',
      departmentId: ctx.departments.get('Warehouse')!,
      legalEntityId: ctx.entities.fsw,
      hiringManagerId: opsLead.id,
      recruiterId: hrAdmin.id,
      locationText: 'Exton, PA (onsite)',
      employmentType: 'FULL_TIME',
      workerType: 'EMPLOYEE',
      headcount: 1,
      salaryMin: 58000,
      salaryMax: 70000,
      description: 'Lead daily warehouse operations for FS Welsford distribution.',
      requirements: '3+ years warehouse experience; forklift certification; leadership experience.',
      status: 'OPEN',
      openedAt: new Date(),
    },
  });
  const candidateNames: [string, string, number][] = [
    ['Jordan', 'Avery', 0],
    ['Sofia', 'Marin', 2],
    ['Chris', 'Donnelly', 4],
  ];
  for (const [first, last, stageIdx] of candidateNames) {
    const cand = await db.candidate.create({
      data: {
        firstName: first,
        lastName: last,
        email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
        phone: '+1 555 0400',
        source: 'INDEED',
        isDemo: true,
      },
    });
    await db.application.create({
      data: { candidateId: cand.id, requisitionId: req.id, stageId: stageIds[stageIdx] },
    });
  }

  console.log('Seeding goals, reviews, benefits, equipment, apps, training…');
  const companyGoal = await db.goal.create({
    data: { level: 'COMPANY', title: `Grow ${year} revenue 15% while maintaining service levels`, status: 'ACTIVE', progress: 40, dueDate: d(`${year}-12-31`) },
  });
  await db.goal.create({
    data: {
      workerId: salesperson.id, level: 'INDIVIDUAL', title: 'Close $1.2M in new valve automation business',
      status: 'ACTIVE', progress: 55, weight: 60, dueDate: d(`${year}-12-31`), parentId: companyGoal.id,
    },
  });
  await db.goal.create({
    data: {
      workerId: engineer.id, level: 'INDIVIDUAL', title: 'Document 10 application engineering SOPs',
      status: 'ACTIVE', progress: 30, weight: 40, dueDate: d(`${year}-11-30`),
    },
  });

  const cycle = await db.reviewCycle.create({
    data: {
      name: `${year} Mid-Year Review`,
      kind: 'SEMIANNUAL',
      startDate: d(`${year}-06-01`),
      dueDate: d(`${year}-07-15`),
      status: 'OPEN',
      questions: [
        { id: 'q1', text: 'What were the biggest accomplishments this period?', type: 'TEXT', forms: ['SELF', 'MANAGER'] },
        { id: 'q2', text: 'What should improve next period?', type: 'TEXT', forms: ['SELF', 'MANAGER'] },
        { id: 'q3', text: 'Overall performance rating', type: 'RATING', forms: ['MANAGER'] },
      ],
    },
  });
  await db.performanceReview.create({
    data: { cycleId: cycle.id, subjectId: salesperson.id, authorId: salesperson.id, form: 'SELF', status: 'IN_PROGRESS' },
  });
  await db.performanceReview.create({
    data: { cycleId: cycle.id, subjectId: salesperson.id, authorId: salesLead.id, form: 'MANAGER', status: 'NOT_STARTED' },
  });

  for (const plan of [
    { kind: 'MEDICAL', name: 'FSW Medical PPO', provider: 'Independence Blue Cross', employeeCostMonthly: 210, employerCostMonthly: 640 },
    { kind: 'DENTAL', name: 'FSW Dental', provider: 'Guardian', employeeCostMonthly: 22, employerCostMonthly: 38 },
    { kind: 'VISION', name: 'FSW Vision', provider: 'VSP', employeeCostMonthly: 8, employerCostMonthly: 12 },
    { kind: 'RETIREMENT_401K', name: 'FSW 401(k)', provider: 'Empower', employeeCostMonthly: null, employerCostMonthly: null },
  ] as const) {
    const p = await db.benefitPlan.create({
      data: { ...plan, waitingPeriodDays: 30, description: '[DEMO] Plan details live in the plan document.' },
    });
    if (plan.kind === 'MEDICAL') {
      await db.benefitEnrollment.create({
        data: {
          workerId: salesperson.id, planId: p.id, status: 'ENROLLED', coverageLevel: 'FAMILY',
          employeeContributionMonthly: 210, employerContributionMonthly: 640,
          electedAt: d(`${year}-01-01`), effectiveFrom: d(`${year}-01-01`),
        },
      });
    }
  }

  const laptop = await db.equipmentAsset.create({
    data: { kind: 'LAPTOP', assetTag: 'FSW-LT-0042', serialNumber: 'DEMO-SN-8842', make: 'Dell', model: 'Latitude 5550', condition: 'GOOD', status: 'ASSIGNED', valueUsd: 1450 },
  });
  await db.equipmentAssignment.create({ data: { assetId: laptop.id, workerId: salesperson.id, returnRequired: true } });
  await db.equipmentAsset.create({
    data: { kind: 'LAPTOP', assetTag: 'FSW-LT-0051', serialNumber: 'DEMO-SN-9013', make: 'Dell', model: 'Latitude 5550', condition: 'NEW', status: 'IN_STOCK', valueUsd: 1450 },
  });

  for (const app of ['Microsoft 365', 'Prophet 21', 'Pipedrive', 'RingCentral', 'BigCommerce', 'Power BI']) {
    await db.softwareApp.create({
      data: { name: app, category: 'Business', autoProvisionOnboarding: ['Microsoft 365', 'RingCentral'].includes(app) },
    });
  }
  const m365 = await db.softwareApp.findUniqueOrThrow({ where: { name: 'Microsoft 365' } });
  for (const w of [ceo, hrAdmin, opsLead, salesLead, salesperson, engineer, remoteUs, phEmployee]) {
    await db.appAccessGrant.create({ data: { appId: m365.id, workerId: w.id, accessLevel: 'USER' } });
  }

  const safety = await db.trainingCourse.create({
    data: {
      title: 'Warehouse Safety Fundamentals', category: 'SAFETY', dueDays: 14, recurrenceMonths: 12,
      autoAssign: true, assignmentRules: { departmentIds: [ctx.departments.get('Warehouse')!] },
      description: 'Annual safety training for warehouse personnel.',
    },
  });
  await db.trainingCourse.create({
    data: {
      title: 'Cybersecurity Awareness', category: 'CYBERSECURITY', dueDays: 30, recurrenceMonths: 12,
      autoAssign: true, assignmentRules: {}, description: 'Annual security awareness for all workers.',
    },
  });
  await db.trainingAssignment.create({
    data: { courseId: safety.id, workerId: warehouse.id, dueDate: new Date(Date.now() + 10 * 86_400_000) },
  });

  console.log('Seeding policies, announcements, workflows, compliance…');
  const handbook = await db.policy.create({ data: { title: 'FSW Group Employee Handbook', category: 'Handbook' } });
  const handbookV1 = await db.policyVersion.create({
    data: {
      policyId: handbook.id, version: 1, requiresAck: true, ackDeadlineDays: 14, publishedAt: new Date(),
      bodyHtml: '<p>[DEMO] The FSW Group handbook describes how we work — replace this placeholder with the HR-approved handbook text or an uploaded PDF. Legal templates must be approved before use.</p>',
      audience: { workerTypes: ['EMPLOYEE'] },
    },
  });
  for (const w of usWorkers) {
    await db.policyAcknowledgment.create({ data: { policyVersionId: handbookV1.id, workerId: w.id } });
  }

  await db.announcement.create({
    data: {
      title: 'Welcome to FSW People',
      bodyHtml: '<p>FSW People is now the home for everything about our team — profiles, time off, documents, goals, reviews and more. Explore your dashboard and complete any outstanding tasks.</p>',
      pinned: true,
      authorUserId: ctx.adminUserId,
    },
  });

  await db.workflowDefinition.create({
    data: {
      name: 'New hire → start onboarding',
      description: 'When a worker is added, automatically start the matching onboarding checklist.',
      trigger: 'WORKER_ADDED',
      actions: [{ type: 'START_ONBOARDING' }, { type: 'NOTIFY_ROLE', roleKey: 'HR_ADMIN', title: 'Onboarding started for {{worker}}' }],
    },
  });
  await db.workflowDefinition.create({
    data: {
      name: 'Contract expiring → notify HR',
      description: 'When a contractor agreement is within 60 days of ending, create an HR renewal task.',
      trigger: 'CONTRACT_EXPIRING',
      actions: [{ type: 'CREATE_TASK', title: 'Review contract renewal for {{worker}}', ownerRoleKey: 'HR_ADMIN', category: 'COMPLIANCE', dueOffsetDays: 14 }],
    },
  });
  await db.workflowDefinition.create({
    data: {
      name: 'Birthday note to manager',
      trigger: 'BIRTHDAY',
      actions: [{ type: 'NOTIFY_USER', userTarget: 'MANAGER', title: "It's {{worker}}'s birthday today 🎉" }],
    },
  });

  const complianceRules = [
    {
      name: 'Form I-9 completion (new hires)',
      category: 'WORK_AUTHORIZATION', jurisdiction: 'US-FED', source: 'USCIS',
      sourceUrl: 'https://www.uscis.gov/i-9',
      description: 'Section 1 by first day of work; Section 2 within 3 business days of start. Retain per USCIS rules (3 years after hire or 1 year after termination, whichever is later). Verify current form version with USCIS.',
      appliesTo: { countries: ['US'], workerTypes: ['EMPLOYEE'] },
      deadlineRule: { anchor: 'HIRE_DATE', offsetDays: 3 }, severity: 'CRITICAL',
    },
    {
      name: 'Form W-4 on file',
      category: 'ONBOARDING_FORMS', jurisdiction: 'US-FED', source: 'IRS',
      sourceUrl: 'https://www.irs.gov/forms-pubs/about-form-w-4',
      description: 'Collect federal withholding certificate at hire. Verify current-year form version with the IRS or payroll provider.',
      appliesTo: { countries: ['US'], workerTypes: ['EMPLOYEE'] },
      deadlineRule: { anchor: 'HIRE_DATE', offsetDays: 0 }, severity: 'HIGH',
    },
    {
      name: 'PA state & local withholding forms',
      category: 'ONBOARDING_FORMS', jurisdiction: 'US-PA', source: 'PA Department of Revenue',
      sourceUrl: 'https://www.pa.gov/agencies/revenue',
      description: 'Pennsylvania Residency Certification Form (local EIT) for PA worksites. Verify requirements with the payroll provider.',
      appliesTo: { countries: ['US'], workerTypes: ['EMPLOYEE'], workStates: ['PA'] },
      deadlineRule: { anchor: 'HIRE_DATE', offsetDays: 0 }, severity: 'HIGH',
    },
    {
      name: 'W-9 on file (US contractors)',
      category: 'CONTRACTOR', jurisdiction: 'US-FED', source: 'IRS',
      sourceUrl: 'https://www.irs.gov/forms-pubs/about-form-w-9',
      description: 'Collect Form W-9 before first payment to a US contractor; needed for 1099-NEC reporting.',
      appliesTo: { countries: ['US'], workerTypes: ['CONTRACTOR'] },
      deadlineRule: { anchor: 'HIRE_DATE', offsetDays: 0 }, severity: 'HIGH',
    },
    {
      name: 'W-8BEN on file (foreign contractors)',
      category: 'CONTRACTOR', jurisdiction: 'US-FED', source: 'IRS',
      sourceUrl: 'https://www.irs.gov/forms-pubs/about-form-w-8-ben',
      description: 'Foreign-person status documentation for non-US contractors paid by a US entity. The correct form (W-8BEN vs W-8BEN-E) depends on the payee — confirm with the tax advisor.',
      appliesTo: { countries: ['PH'], workerTypes: ['CONTRACTOR'] },
      deadlineRule: { anchor: 'HIRE_DATE', offsetDays: 0 }, severity: 'HIGH',
    },
    {
      name: 'PH Data Privacy Act notice & consent',
      category: 'POLICY', jurisdiction: 'PH', source: 'Philippine National Privacy Commission',
      sourceUrl: 'https://privacy.gov.ph',
      description: 'Provide a privacy notice covering legitimate purpose, minimal collection, retention and data subject rights; record acknowledgment.',
      appliesTo: { countries: ['PH'] },
      deadlineRule: { anchor: 'HIRE_DATE', offsetDays: 7 }, severity: 'MEDIUM',
    },
  ] as const;
  for (const rule of complianceRules) {
    await db.complianceRule.create({
      data: { ...rule, appliesTo: rule.appliesTo as object, deadlineRule: rule.deadlineRule as object, lastReviewedAt: new Date(), nextReviewAt: d(`${year + 1}-01-15`) },
    });
  }

  for (const rp of [
    { recordType: 'I9', jurisdiction: 'US-FED', anchor: 'TERMINATION', retainYears: 3, note: '3 years after hire OR 1 year after termination, whichever is later — verify with counsel.', sourceUrl: 'https://www.uscis.gov/i-9-central' },
    { recordType: 'PAYROLL', jurisdiction: 'US-FED', anchor: 'CREATION', retainYears: 4, note: 'IRS employment tax records guidance.', sourceUrl: 'https://www.irs.gov' },
    { recordType: 'PERSONNEL', jurisdiction: 'US-FED', anchor: 'TERMINATION', retainYears: 4, note: 'Baseline; extend per state/claim requirements.', sourceUrl: 'https://www.eeoc.gov' },
    { recordType: 'RECRUITING', jurisdiction: 'US-FED', anchor: 'CREATION', retainYears: 2, note: 'EEOC/ADEA baseline for applications and hiring records.', sourceUrl: 'https://www.eeoc.gov' },
    { recordType: 'TIMEKEEPING', jurisdiction: 'US-FED', anchor: 'CREATION', retainYears: 3, note: 'FLSA payroll/time records.', sourceUrl: 'https://www.dol.gov' },
  ] as const) {
    await db.retentionPolicy.create({ data: { ...rp, retainYears: rp.retainYears } });
  }

  console.log('Seeding salary bands + payroll period…');
  for (const band of [
    { jobFamily: 'Sales', jobLevel: 'IC2', minAmount: 50000, midAmount: 60000, maxAmount: 72000 },
    { jobFamily: 'Sales', jobLevel: 'IC3', minAmount: 65000, midAmount: 80000, maxAmount: 95000 },
    { jobFamily: 'Engineering', jobLevel: 'IC3', minAmount: 80000, midAmount: 95000, maxAmount: 110000 },
    { jobFamily: 'Warehouse', jobLevel: 'IC1', minAmount: 37000, midAmount: 44000, maxAmount: 52000 },
  ]) {
    await db.salaryBand.create({ data: { ...band, geography: 'US', currency: 'USD' } });
  }
  const periodStart = new Date(Date.UTC(year, new Date().getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(year, new Date().getUTCMonth() + 1, 0));
  await db.payrollPeriod.create({
    data: { legalEntityCode: 'ALL', periodStart, periodEnd, payDate: new Date(periodEnd.getTime() + 5 * 86_400_000) },
  });

  console.log('Seeding documents, compliance items, timesheets…');

  // A signed handbook document for the sales rep (company-wide handbook + one signed copy)
  const handbookDoc = await db.document.create({
    data: {
      title: 'FSW Group Employee Handbook (v1)',
      category: 'HANDBOOK',
      classification: 'INTERNAL',
      uploadedById: ctx.adminUserId,
      versions: {
        create: {
          version: 1,
          fileKey: 'demo/handbook-v1.txt',
          fileName: 'fsw-handbook-v1.txt',
          mimeType: 'text/plain',
          sizeBytes: 512,
          approvedBy: '[DEMO] pending legal review',
          effectiveAt: new Date(),
          uploadedById: ctx.adminUserId,
        },
      },
    },
  });
  // Work authorization document with an upcoming expiry, to exercise alerts
  await db.document.create({
    data: {
      title: 'Work authorization — expires soon (demo)',
      category: 'ID_DOCUMENT',
      classification: 'HIGHLY_RESTRICTED',
      workerId: phContractor.id,
      expiresAt: new Date(Date.now() + 21 * 86_400_000),
      uploadedById: ctx.adminUserId,
      versions: {
        create: {
          version: 1,
          fileKey: 'demo/work-auth.txt',
          fileName: 'work-auth.txt',
          mimeType: 'text/plain',
          sizeBytes: 256,
          uploadedById: ctx.adminUserId,
        },
      },
    },
  });

  // An approved timesheet for the hourly warehouse employee
  const mondayOffset = (new Date().getUTCDay() + 6) % 7;
  const weekStart = new Date(Date.now() - mondayOffset * 86_400_000);
  weekStart.setUTCHours(0, 0, 0, 0);
  const sheet = await db.timesheet.create({
    data: { workerId: warehouse.id, weekStart, status: 'SUBMITTED', submittedAt: new Date() },
  });
  for (let day = 0; day < 5; day++) {
    const date = new Date(weekStart.getTime() + day * 86_400_000);
    await db.timeEntry.create({
      data: {
        timesheetId: sheet.id,
        date,
        clockIn: new Date(date.getTime() + 7 * 3600_000),
        clockOut: new Date(date.getTime() + 15.5 * 3600_000),
        breakMinutes: 30,
      },
    });
  }

  // Materialize compliance items for the seeded rules
  const { syncComplianceItemsSeed } = await import('./seed-compliance');
  const itemCount = await syncComplianceItemsSeed(db);

  // A 1:1 between the sales lead and the account executive
  await db.oneOnOne.create({
    data: {
      managerId: salesLead.id,
      reportId: salesperson.id,
      scheduledAt: new Date(Date.now() + 2 * 86_400_000),
      agenda: '[DEMO] Pipeline review, Q4 targets, territory questions.',
      status: 'SCHEDULED',
    },
  });

  // Recognition in the feedback feed
  await db.feedback.create({
    data: {
      aboutId: engineer.id,
      authorId: opsLead.id,
      kind: 'PRAISE',
      visibility: 'PUBLIC',
      body: '[DEMO] Turned around a complex valve sizing question for a customer in under an hour. Great work.',
    },
  });

  // --- Break rules and shift templates --------------------------------------
  // Data, not code: jurisdictional and subject to change, so each rule carries
  // where it applies and the authority behind it. Verify current requirements
  // with counsel — these are seeded as a starting point, not as legal advice.
  await db.breakRule.createMany({
    data: [
      {
        jurisdiction: 'US-PA', name: 'Minors: 30-minute meal after 5 hours',
        afterMinutes: 300, breakMinutes: 30, kind: 'MEAL', paid: false, appliesToMinors: true,
        sourceUrl: 'https://www.dli.pa.gov/Individuals/Labor-Management-Relations/llc/Pages/Child-Labor-Act.aspx',
        note: '[DEMO] Pennsylvania requires meal periods for minors; adult meal breaks are not mandated by state law.',
      },
      {
        jurisdiction: 'US-CA', name: '30-minute unpaid meal after 5 hours',
        afterMinutes: 300, breakMinutes: 30, kind: 'MEAL', paid: false,
        sourceUrl: 'https://www.dir.ca.gov/dlse/faq_mealperiods.htm',
        note: '[DEMO] California meal period requirement.',
      },
      {
        jurisdiction: 'US-CA', name: 'Second 30-minute meal after 10 hours',
        afterMinutes: 600, breakMinutes: 60, kind: 'MEAL', paid: false,
        sourceUrl: 'https://www.dir.ca.gov/dlse/faq_mealperiods.htm',
        note: '[DEMO] A second meal period is required on shifts over ten hours.',
      },
      {
        jurisdiction: 'US-CA', name: '10-minute paid rest per 4 hours',
        afterMinutes: 240, breakMinutes: 10, kind: 'REST', paid: true,
        sourceUrl: 'https://www.dir.ca.gov/dlse/faq_restperiods.htm',
        note: '[DEMO] Paid rest periods are not deducted from scheduled hours.',
      },
      {
        jurisdiction: 'PH', name: '60-minute unpaid meal after 5 hours',
        afterMinutes: 300, breakMinutes: 60, kind: 'MEAL', paid: false,
        sourceUrl: 'https://www.dole.gov.ph/',
        note: '[DEMO] Philippine Labor Code meal period. Confirm with local counsel.',
      },
    ],
  });

  const dayShift = await db.shiftTemplate.create({
    data: { name: 'Warehouse day (06:00–14:30)', locationId: ctx.locations.exton, startTime: '06:00', endTime: '14:30', breakMinutes: 30 },
  });
  await db.shiftTemplate.create({
    data: { name: 'Warehouse late (14:00–22:30)', locationId: ctx.locations.exton, startTime: '14:00', endTime: '22:30', breakMinutes: 30 },
  });

  // A published week for the hourly crew, including one shift with a short
  // break so the compliance check has something to find.
  const monday = new Date();
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  for (let i = 0; i < 5; i++) {
    const date = new Date(monday.getTime() + i * 86_400_000);
    const shift = await db.shift.create({
      data: {
        templateId: dayShift.id,
        locationId: ctx.locations.exton,
        departmentId: ctx.departments.get('Warehouse')!,
        date,
        startsAt: new Date(date.getTime() + 6 * 3_600_000),
        endsAt: new Date(date.getTime() + 14.5 * 3_600_000),
        breakMinutes: i === 2 ? 15 : 30,
        role: 'Picker',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        note: i === 2 ? '[DEMO] Short break — appears in the break rule findings.' : null,
      },
    });
    await db.shiftAssignment.create({ data: { shiftId: shift.id, workerId: warehouse.id } });
  }

  // --- Skills and certifications --------------------------------------------
  // Deliberately seeded to show real coverage risk: the forklift certification
  // has one verified holder (single point of failure) and OSHA 30 has one that
  // has already lapsed (uncovered).
  const forklift = await db.skill.create({
    data: {
      name: 'Forklift operation (sit-down)', category: 'EQUIPMENT', isCertification: true,
      isCritical: true, validityMonths: 36,
      description: 'Powered industrial truck certification per OSHA 1910.178.',
    },
  });
  const osha30 = await db.skill.create({
    data: {
      name: 'OSHA 30 (General Industry)', category: 'SAFETY', isCertification: true,
      isCritical: true, validityMonths: 60,
      description: 'Thirty-hour general industry safety course.',
    },
  });
  const p21Skill = await db.skill.create({
    data: { name: 'Prophet 21', category: 'SYSTEM', description: 'Order entry, inventory and purchasing in the ERP.' },
  });
  const valveSizing = await db.skill.create({
    data: { name: 'Valve sizing & selection', category: 'PRODUCT', isCritical: true, description: 'Sizing control and isolation valves to a customer spec.' },
  });
  await db.skill.create({
    data: { name: 'Tagalog', category: 'LANGUAGE', description: 'Spoken and written Tagalog.' },
  });

  const inThreeWeeks = new Date(Date.now() + 21 * 86_400_000);
  const lastMonth = new Date(Date.now() - 30 * 86_400_000);

  // Forklift: one verified holder → single point of failure.
  await db.workerSkill.create({
    data: {
      workerId: warehouse.id, skillId: forklift.id, level: 4,
      verifiedById: ctx.adminUserId, verifiedAt: new Date(), acquiredAt: new Date(Date.now() - 200 * 86_400_000),
      expiresAt: inThreeWeeks, note: '[DEMO] Renewal due — booked with the training vendor.',
    },
  });
  // OSHA 30: the only recorded holder has already lapsed → uncovered.
  await db.workerSkill.create({
    data: {
      workerId: opsLead.id, skillId: osha30.id, level: 4,
      verifiedById: ctx.adminUserId, verifiedAt: lastMonth, expiresAt: lastMonth,
      note: '[DEMO] Lapsed — renewal not yet scheduled.',
    },
  });
  // Healthy coverage on the ERP.
  for (const w of [salesperson, warehouse, opsLead, finLead]) {
    await db.workerSkill.create({
      data: { workerId: w.id, skillId: p21Skill.id, level: w.id === finLead.id ? 5 : 3, sourceType: 'MANUAL' },
    });
  }
  await db.workerSkill.create({
    data: {
      workerId: salesperson.id, skillId: valveSizing.id, level: 4,
      verifiedById: ctx.adminUserId, verifiedAt: new Date(),
    },
  });
  await db.workerSkill.create({
    data: {
      workerId: engineer.id, skillId: valveSizing.id, level: 5,
      verifiedById: ctx.adminUserId, verifiedAt: new Date(),
    },
  });
  // An open pulse survey
  await db.survey.create({
    data: {
      title: 'Quarterly pulse check',
      kind: 'PULSE',
      anonymous: true,
      status: 'OPEN',
      opensAt: new Date(),
      closesAt: new Date(Date.now() + 14 * 86_400_000),
      minResponsesToShow: 3,
      questions: [
        { id: 'q1', text: 'How are you feeling about work right now?', type: 'SCALE' },
        { id: 'q2', text: 'How likely are you to recommend FSW as a place to work?', type: 'ENPS' },
        { id: 'q3', text: 'What is one thing we should improve?', type: 'TEXT' },
      ],
    },
  });

  console.log(`Demo data ready: ${await db.worker.count()} workers, ${itemCount} compliance items, handbook ${handbookDoc.id.slice(0, 6)}.`);
}
