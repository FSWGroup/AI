/**
 * FSW Academy database seed.
 *
 * Creates:
 *  - roles with default permissions
 *  - the FSW Group organization, business units, departments, teams, locations
 *  - positions with training and skill requirements
 *  - demonstration people covering every worker type and role
 *  - the skills library and proficiency scale
 *  - demonstration SOPs (published, versioned) and courses
 *  - the New Employee Onboarding learning path
 *  - assignment rules, compliance rules, announcements
 *
 * Idempotent: safe to run repeatedly. Uses upserts keyed on natural keys.
 *
 * Demonstration content is labelled as such and states that it is an example,
 * not approved FSW policy.
 */

import { PrismaClient, type Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  DEFAULT_ROLE_PERMISSIONS,
  ROLE_DESCRIPTIONS,
  ROLE_KEYS,
  ROLE_LABELS,
  type RoleKey,
} from "../src/lib/permissions";
import { DEMO_SOPS, DEMO_COURSES, DEMO_PATH } from "./seed-content";

const prisma = new PrismaClient();

/** Development password for every seeded account. Documented in README. */
const DEV_PASSWORD = process.env.SEED_PASSWORD ?? "FswAcademy!2026";

const SKILL_SCALE = [
  { value: 0, name: "None" },
  { value: 1, name: "Awareness" },
  { value: 2, name: "Beginner" },
  { value: 3, name: "Working" },
  { value: 4, name: "Proficient" },
  { value: 5, name: "Advanced" },
  { value: 6, name: "Expert" },
];

const SKILLS = [
  { name: "Valve Fundamentals", category: "Product" },
  { name: "Ball Valves", category: "Product" },
  { name: "Control Valves", category: "Product" },
  { name: "Actuation", category: "Product" },
  { name: "Technical Product Selection", category: "Product" },
  { name: "Quoting", category: "Sales" },
  { name: "Customer Service", category: "Sales" },
  { name: "Order Processing", category: "Operations" },
  { name: "Purchasing", category: "Operations" },
  { name: "Warehouse Receiving", category: "Operations" },
  { name: "Shipping and Packing", category: "Operations" },
  { name: "ERP System (P21)", category: "Systems" },
  { name: "Excel", category: "Systems" },
  { name: "E-commerce Merchandising", category: "E-commerce" },
  { name: "Accounts Receivable", category: "Accounting" },
  { name: "Management", category: "Leadership" },
  { name: "Cybersecurity Awareness", category: "Compliance" },
];

async function seedRoles() {
  console.log("→ Roles and permissions");
  const roleIds = new Map<RoleKey, string>();

  for (const key of Object.values(ROLE_KEYS)) {
    const role = await prisma.role.upsert({
      where: { key },
      create: {
        key,
        name: ROLE_LABELS[key],
        description: ROLE_DESCRIPTIONS[key],
        isSystem: true,
      },
      update: { name: ROLE_LABELS[key], description: ROLE_DESCRIPTIONS[key] },
      select: { id: true },
    });
    roleIds.set(key, role.id);

    // Replace the permission set so seed runs converge on the declared defaults.
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: DEFAULT_ROLE_PERMISSIONS[key].map((permission) => ({
        roleId: role.id,
        permission,
      })),
      skipDuplicates: true,
    });
  }

  return roleIds;
}

async function seedOrganization() {
  console.log("→ Organization structure");

  const org = await prisma.organization.upsert({
    where: { id: "org_fsw_group" },
    create: { id: "org_fsw_group", name: "FSW Group" },
    update: { name: "FSW Group" },
  });

  const businessUnits = await Promise.all(
    [
      {
        slug: "welsford",
        name: "Welsford",
        description: "Industrial valve and flow-control distribution.",
      },
      {
        slug: "valveman",
        name: "ValveMan",
        description: "Direct-to-customer e-commerce valve sales.",
      },
      {
        slug: "shared-services",
        name: "FSW Group Shared Services",
        description: "Accounting, HR, IT, and corporate functions shared across FSW businesses.",
      },
    ].map((unit) =>
      prisma.businessUnit.upsert({
        where: { slug: unit.slug },
        create: { ...unit, organizationId: org.id },
        update: { name: unit.name, description: unit.description },
      }),
    ),
  );

  const [welsford, valveman, shared] = businessUnits;
  if (!welsford || !valveman || !shared) throw new Error("Business unit seed failed");

  const departmentSpecs: { name: string; businessUnitId: string; teams: string[] }[] = [
    { name: "Sales", businessUnitId: welsford.id, teams: ["Inside Sales", "Outside Sales"] },
    {
      name: "Application Engineering",
      businessUnitId: welsford.id,
      teams: ["Technical Support"],
    },
    { name: "Operations", businessUnitId: welsford.id, teams: ["Warehouse", "Purchasing"] },
    { name: "E-commerce", businessUnitId: valveman.id, teams: ["Merchandising", "Customer Care"] },
    { name: "Accounting", businessUnitId: shared.id, teams: ["Accounts Receivable"] },
    { name: "People and Culture", businessUnitId: shared.id, teams: ["HR"] },
    { name: "Information Technology", businessUnitId: shared.id, teams: ["IT Operations"] },
  ];

  const departments = new Map<string, string>();
  const teams = new Map<string, string>();

  for (const spec of departmentSpecs) {
    const existing = await prisma.department.findFirst({
      where: { name: spec.name, businessUnitId: spec.businessUnitId },
      select: { id: true },
    });
    const department =
      existing ??
      (await prisma.department.create({
        data: { name: spec.name, businessUnitId: spec.businessUnitId },
        select: { id: true },
      }));
    departments.set(spec.name, department.id);

    for (const teamName of spec.teams) {
      const existingTeam = await prisma.team.findFirst({
        where: { name: teamName, departmentId: department.id },
        select: { id: true },
      });
      const team =
        existingTeam ??
        (await prisma.team.create({
          data: { name: teamName, departmentId: department.id },
          select: { id: true },
        }));
      teams.set(teamName, team.id);
    }
  }

  const locationSpecs = [
    { id: "loc_hq", name: "Headquarters — Charlotte, NC", country: "US", state: "NC", city: "Charlotte", timezone: "America/New_York" },
    { id: "loc_warehouse", name: "Distribution Center — Charlotte, NC", country: "US", state: "NC", city: "Charlotte", timezone: "America/New_York" },
    { id: "loc_remote_us", name: "Remote — United States", country: "US", state: null, city: null, timezone: "America/New_York" },
    { id: "loc_manila", name: "Manila Office — Philippines", country: "PH", state: null, city: "Manila", timezone: "Asia/Manila" },
  ];

  const locations = new Map<string, string>();
  for (const spec of locationSpecs) {
    const location = await prisma.location.upsert({
      where: { id: spec.id },
      create: spec,
      update: { name: spec.name, timezone: spec.timezone },
      select: { id: true },
    });
    locations.set(spec.id, location.id);
  }

  return { org, welsford, valveman, shared, departments, teams, locations };
}

async function seedSkills() {
  console.log("→ Skills library");

  for (const level of SKILL_SCALE) {
    await prisma.skillLevel.upsert({
      where: { value: level.value },
      create: level,
      update: { name: level.name },
    });
  }

  const skillIds = new Map<string, string>();
  for (const skill of SKILLS) {
    const record = await prisma.skill.upsert({
      where: { name: skill.name },
      create: skill,
      update: { category: skill.category },
      select: { id: true },
    });
    skillIds.set(skill.name, record.id);
  }
  return skillIds;
}

async function seedPositions(
  departments: Map<string, string>,
  skillIds: Map<string, string>,
) {
  console.log("→ Positions");

  const specs: {
    id: string;
    title: string;
    department: string;
    responsibilities: string[];
    toolsUsed: string[];
    skills: { name: string; level: number }[];
  }[] = [
    {
      id: "pos_inside_sales",
      title: "Inside Sales Representative",
      department: "Sales",
      responsibilities: [
        "Respond to customer inquiries and quote requests",
        "Prepare and follow up on customer quotes",
        "Enter and confirm customer orders",
        "Coordinate with warehouse on shipment timing",
      ],
      toolsUsed: ["P21 ERP", "Microsoft Outlook", "Microsoft Teams", "Excel"],
      skills: [
        { name: "Quoting", level: 4 },
        { name: "Customer Service", level: 4 },
        { name: "Valve Fundamentals", level: 3 },
        { name: "ERP System (P21)", level: 3 },
      ],
    },
    {
      id: "pos_outside_sales",
      title: "Outside Sales Representative",
      department: "Sales",
      responsibilities: [
        "Own customer relationships in an assigned territory",
        "Identify and develop new accounts",
        "Coordinate technical support for customer applications",
      ],
      toolsUsed: ["P21 ERP", "CRM", "Microsoft Teams"],
      skills: [
        { name: "Quoting", level: 4 },
        { name: "Technical Product Selection", level: 4 },
        { name: "Valve Fundamentals", level: 4 },
      ],
    },
    {
      id: "pos_app_engineer",
      title: "Application Engineer",
      department: "Application Engineering",
      responsibilities: [
        "Select valves and actuation for customer applications",
        "Review specifications and provide technical recommendations",
        "Support sales with sizing and material selection",
      ],
      toolsUsed: ["P21 ERP", "Sizing software", "Excel"],
      skills: [
        { name: "Technical Product Selection", level: 5 },
        { name: "Control Valves", level: 5 },
        { name: "Actuation", level: 4 },
        { name: "Valve Fundamentals", level: 5 },
      ],
    },
    {
      id: "pos_warehouse_assoc",
      title: "Warehouse Associate",
      department: "Operations",
      responsibilities: [
        "Receive and verify inbound shipments",
        "Pick, pack, and stage outbound orders",
        "Maintain inventory accuracy and a safe work area",
      ],
      toolsUsed: ["P21 ERP", "Barcode scanner", "Forklift"],
      skills: [
        { name: "Warehouse Receiving", level: 4 },
        { name: "Shipping and Packing", level: 4 },
      ],
    },
    {
      id: "pos_ecom_specialist",
      title: "E-commerce Specialist",
      department: "E-commerce",
      responsibilities: [
        "Maintain product listings, imagery, and specifications",
        "Monitor site merchandising and category performance",
        "Handle online customer questions and order issues",
      ],
      toolsUsed: ["E-commerce platform", "P21 ERP", "Excel"],
      skills: [
        { name: "E-commerce Merchandising", level: 4 },
        { name: "Customer Service", level: 3 },
        { name: "Valve Fundamentals", level: 3 },
      ],
    },
    {
      id: "pos_ar_specialist",
      title: "Accounts Receivable Specialist",
      department: "Accounting",
      responsibilities: [
        "Apply customer payments and reconcile accounts",
        "Follow up on past-due balances",
        "Support month-end close",
      ],
      toolsUsed: ["P21 ERP", "Excel", "Banking portal"],
      skills: [
        { name: "Accounts Receivable", level: 4 },
        { name: "Excel", level: 4 },
      ],
    },
    {
      id: "pos_sales_manager",
      title: "Sales Manager",
      department: "Sales",
      responsibilities: [
        "Lead and coach the sales team",
        "Review pipeline and quote activity",
        "Approve pricing exceptions within authority",
        "Complete onboarding sign-offs for new team members",
      ],
      toolsUsed: ["P21 ERP", "CRM", "Excel"],
      skills: [
        { name: "Management", level: 4 },
        { name: "Quoting", level: 5 },
        { name: "Customer Service", level: 4 },
      ],
    },
    {
      id: "pos_hr_manager",
      title: "HR Manager",
      department: "People and Culture",
      responsibilities: [
        "Own hiring, onboarding, and employee records",
        "Administer policy acknowledgement and compliance training",
        "Support managers on people matters",
      ],
      toolsUsed: ["HRIS", "FSW Academy", "Excel"],
      skills: [{ name: "Management", level: 4 }],
    },
    {
      id: "pos_it_admin",
      title: "IT Administrator",
      department: "Information Technology",
      responsibilities: [
        "Administer Microsoft 365 and endpoint security",
        "Support employees with systems access",
        "Maintain cybersecurity controls and awareness training",
      ],
      toolsUsed: ["Microsoft 365 admin", "Endpoint management"],
      skills: [{ name: "Cybersecurity Awareness", level: 5 }],
    },
  ];

  const positionIds = new Map<string, string>();

  for (const spec of positions_iter(specs)) {
    const departmentId = departments.get(spec.department);
    const position = await prisma.position.upsert({
      where: { id: spec.id },
      create: {
        id: spec.id,
        title: spec.title,
        departmentId,
        responsibilities: spec.responsibilities as Prisma.InputJsonValue,
        toolsUsed: spec.toolsUsed as Prisma.InputJsonValue,
      },
      update: {
        title: spec.title,
        departmentId,
        responsibilities: spec.responsibilities as Prisma.InputJsonValue,
        toolsUsed: spec.toolsUsed as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    positionIds.set(spec.id, position.id);

    for (const requirement of spec.skills) {
      const skillId = skillIds.get(requirement.name);
      if (!skillId) continue;
      await prisma.positionSkillRequirement.upsert({
        where: { positionId_skillId: { positionId: position.id, skillId } },
        create: { positionId: position.id, skillId, requiredLevel: requirement.level },
        update: { requiredLevel: requirement.level },
      });
    }
  }

  return positionIds;
}

/** Small helper so the long spec array reads cleanly above. */
function positions_iter<T>(specs: T[]): T[] {
  return specs;
}

interface PersonSpec {
  id: string;
  email: string;
  name: string;
  legalName?: string;
  title: string;
  employeeId: string;
  roles: RoleKey[];
  workerType: "US_EMPLOYEE" | "US_CONTRACTOR" | "PH_EMPLOYEE" | "PH_CONTRACTOR" | "INTL_EMPLOYEE" | "INTL_CONTRACTOR";
  country: string;
  state?: string;
  timezone: string;
  businessUnit: "welsford" | "valveman" | "shared-services";
  department: string;
  team?: string;
  position?: string;
  location: string;
  managerEmail?: string;
  startDate: string;
}

async function seedPeople(
  roleIds: Map<RoleKey, string>,
  units: { welsford: { id: string }; valveman: { id: string }; shared: { id: string } },
  departments: Map<string, string>,
  teams: Map<string, string>,
  positionIds: Map<string, string>,
  locations: Map<string, string>,
) {
  console.log("→ People");

  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 12);

  // Demonstration people. Fictional names and FSW-domain emails — no real
  // personal data.
  const specs: PersonSpec[] = [
    {
      id: "user_super_admin",
      email: "admin@fswelsford.com",
      name: "Avery Nolan",
      legalName: "Avery R. Nolan",
      title: "Director of Operations Technology",
      employeeId: "FSW-0001",
      roles: [ROLE_KEYS.SUPER_ADMIN],
      workerType: "US_EMPLOYEE",
      country: "US",
      state: "NC",
      timezone: "America/New_York",
      businessUnit: "shared-services",
      department: "Information Technology",
      team: "IT Operations",
      position: "pos_it_admin",
      location: "loc_hq",
      startDate: "2019-03-04",
    },
    {
      id: "user_training_admin",
      email: "training.admin@fswelsford.com",
      name: "Rosa Delgado",
      title: "Training Program Manager",
      employeeId: "FSW-0002",
      roles: [ROLE_KEYS.TRAINING_ADMIN, ROLE_KEYS.CONTENT_AUTHOR],
      workerType: "US_EMPLOYEE",
      country: "US",
      state: "NC",
      timezone: "America/New_York",
      businessUnit: "shared-services",
      department: "People and Culture",
      team: "HR",
      location: "loc_hq",
      managerEmail: "hr.admin@fswelsford.com",
      startDate: "2021-06-14",
    },
    {
      id: "user_hr_admin",
      email: "hr.admin@fswelsford.com",
      name: "Marcus Bell",
      title: "HR Manager",
      employeeId: "FSW-0003",
      roles: [ROLE_KEYS.HR_ADMIN, ROLE_KEYS.MANAGER],
      workerType: "US_EMPLOYEE",
      country: "US",
      state: "NC",
      timezone: "America/New_York",
      businessUnit: "shared-services",
      department: "People and Culture",
      team: "HR",
      position: "pos_hr_manager",
      location: "loc_hq",
      startDate: "2018-01-08",
    },
    {
      id: "user_compliance_admin",
      email: "compliance@fswelsford.com",
      name: "Diane Okafor",
      title: "Compliance and Safety Coordinator",
      employeeId: "FSW-0004",
      roles: [ROLE_KEYS.COMPLIANCE_ADMIN],
      workerType: "US_EMPLOYEE",
      country: "US",
      state: "NC",
      timezone: "America/New_York",
      businessUnit: "shared-services",
      department: "People and Culture",
      location: "loc_hq",
      managerEmail: "hr.admin@fswelsford.com",
      startDate: "2020-09-21",
    },
    {
      id: "user_us_manager",
      email: "sales.manager@fswelsford.com",
      name: "Tom Rivera",
      title: "Inside Sales Manager",
      employeeId: "FSW-0010",
      roles: [ROLE_KEYS.MANAGER, ROLE_KEYS.INSTRUCTOR],
      workerType: "US_EMPLOYEE",
      country: "US",
      state: "NC",
      timezone: "America/New_York",
      businessUnit: "welsford",
      department: "Sales",
      team: "Inside Sales",
      position: "pos_sales_manager",
      location: "loc_hq",
      startDate: "2017-05-15",
    },
    {
      id: "user_us_employee",
      email: "jordan.pace@fswelsford.com",
      name: "Jordan Pace",
      title: "Inside Sales Representative",
      employeeId: "FSW-0011",
      roles: [ROLE_KEYS.LEARNER],
      workerType: "US_EMPLOYEE",
      country: "US",
      state: "NC",
      timezone: "America/New_York",
      businessUnit: "welsford",
      department: "Sales",
      team: "Inside Sales",
      position: "pos_inside_sales",
      location: "loc_hq",
      managerEmail: "sales.manager@fswelsford.com",
      // Recent hire so the onboarding path shows realistic relative due dates.
      startDate: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    },
    {
      id: "user_us_employee_2",
      email: "kim.harlow@fswelsford.com",
      name: "Kim Harlow",
      title: "Application Engineer",
      employeeId: "FSW-0012",
      roles: [ROLE_KEYS.LEARNER, ROLE_KEYS.SME],
      workerType: "US_EMPLOYEE",
      country: "US",
      state: "NC",
      timezone: "America/New_York",
      businessUnit: "welsford",
      department: "Application Engineering",
      team: "Technical Support",
      position: "pos_app_engineer",
      location: "loc_hq",
      managerEmail: "sales.manager@fswelsford.com",
      startDate: "2022-02-28",
    },
    {
      id: "user_warehouse",
      email: "dev.singh@fswelsford.com",
      name: "Dev Singh",
      title: "Warehouse Associate",
      employeeId: "FSW-0013",
      roles: [ROLE_KEYS.LEARNER],
      workerType: "US_EMPLOYEE",
      country: "US",
      state: "NC",
      timezone: "America/New_York",
      businessUnit: "welsford",
      department: "Operations",
      team: "Warehouse",
      position: "pos_warehouse_assoc",
      location: "loc_warehouse",
      managerEmail: "sales.manager@fswelsford.com",
      startDate: "2023-11-06",
    },
    {
      id: "user_ph_manager",
      email: "ph.manager@fswelsford.com",
      name: "Liza Ramos",
      title: "E-commerce Team Lead",
      employeeId: "FSW-0020",
      roles: [ROLE_KEYS.MANAGER],
      workerType: "PH_EMPLOYEE",
      country: "PH",
      timezone: "Asia/Manila",
      businessUnit: "valveman",
      department: "E-commerce",
      team: "Merchandising",
      position: "pos_ecom_specialist",
      location: "loc_manila",
      startDate: "2021-04-12",
    },
    {
      id: "user_ph_contractor",
      email: "ph.contractor@fswelsford.com",
      name: "Nico Bautista",
      title: "E-commerce Content Contractor",
      employeeId: "FSW-C0021",
      roles: [ROLE_KEYS.CONTRACTOR],
      workerType: "PH_CONTRACTOR",
      country: "PH",
      timezone: "Asia/Manila",
      businessUnit: "valveman",
      department: "E-commerce",
      team: "Merchandising",
      location: "loc_manila",
      managerEmail: "ph.manager@fswelsford.com",
      startDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    },
    {
      id: "user_us_contractor",
      email: "us.contractor@fswelsford.com",
      name: "Casey Lund",
      title: "Technical Writing Contractor",
      employeeId: "FSW-C0022",
      roles: [ROLE_KEYS.CONTRACTOR, ROLE_KEYS.CONTENT_AUTHOR],
      workerType: "US_CONTRACTOR",
      country: "US",
      state: "TX",
      timezone: "America/Chicago",
      businessUnit: "shared-services",
      department: "People and Culture",
      location: "loc_remote_us",
      managerEmail: "training.admin@fswelsford.com",
      startDate: "2025-01-20",
    },
    {
      id: "user_author",
      email: "author@fswelsford.com",
      name: "Priya Raman",
      title: "Instructional Designer",
      employeeId: "FSW-0030",
      roles: [ROLE_KEYS.CONTENT_AUTHOR],
      workerType: "US_EMPLOYEE",
      country: "US",
      state: "NC",
      timezone: "America/New_York",
      businessUnit: "shared-services",
      department: "People and Culture",
      location: "loc_remote_us",
      managerEmail: "training.admin@fswelsford.com",
      startDate: "2024-08-05",
    },
    {
      id: "user_auditor",
      email: "auditor@fswelsford.com",
      name: "Grant Whitfield",
      title: "Internal Auditor",
      employeeId: "FSW-0040",
      roles: [ROLE_KEYS.AUDITOR],
      workerType: "US_CONTRACTOR",
      country: "US",
      state: "NC",
      timezone: "America/New_York",
      businessUnit: "shared-services",
      department: "Accounting",
      location: "loc_remote_us",
      startDate: "2025-03-03",
    },
    {
      id: "user_accounting",
      email: "ar@fswelsford.com",
      name: "Sofia Marchetti",
      title: "Accounts Receivable Specialist",
      employeeId: "FSW-0041",
      roles: [ROLE_KEYS.LEARNER],
      workerType: "US_EMPLOYEE",
      country: "US",
      state: "NC",
      timezone: "America/New_York",
      businessUnit: "shared-services",
      department: "Accounting",
      team: "Accounts Receivable",
      position: "pos_ar_specialist",
      location: "loc_hq",
      managerEmail: "hr.admin@fswelsford.com",
      startDate: "2022-10-17",
    },
  ];

  const unitIdBySlug: Record<string, string> = {
    welsford: units.welsford.id,
    valveman: units.valveman.id,
    "shared-services": units.shared.id,
  };

  // Pass 1: create/update everyone without manager links.
  for (const spec of specs) {
    await prisma.user.upsert({
      where: { email: spec.email },
      create: {
        id: spec.id,
        email: spec.email,
        name: spec.name,
        legalName: spec.legalName ?? null,
        title: spec.title,
        employeeId: spec.employeeId,
        passwordHash,
        emailVerified: new Date(),
        status: "ACTIVE",
        workerType: spec.workerType,
        country: spec.country,
        state: spec.state ?? null,
        timezone: spec.timezone,
        language: "en",
        startDate: new Date(spec.startDate),
        trainingStartDate: new Date(spec.startDate),
        businessUnitId: unitIdBySlug[spec.businessUnit],
        departmentId: departments.get(spec.department) ?? null,
        teamId: spec.team ? (teams.get(spec.team) ?? null) : null,
        positionId: spec.position ? (positionIds.get(spec.position) ?? null) : null,
        locationId: locations.get(spec.location) ?? null,
      },
      update: {
        name: spec.name,
        title: spec.title,
        passwordHash,
        workerType: spec.workerType,
        businessUnitId: unitIdBySlug[spec.businessUnit],
        departmentId: departments.get(spec.department) ?? null,
        teamId: spec.team ? (teams.get(spec.team) ?? null) : null,
        positionId: spec.position ? (positionIds.get(spec.position) ?? null) : null,
        locationId: locations.get(spec.location) ?? null,
        timezone: spec.timezone,
      },
    });
  }

  // Pass 2: manager relationships and roles, now that all rows exist.
  for (const spec of specs) {
    const user = await prisma.user.findUnique({
      where: { email: spec.email },
      select: { id: true },
    });
    if (!user) continue;

    if (spec.managerEmail) {
      const manager = await prisma.user.findUnique({
        where: { email: spec.managerEmail },
        select: { id: true },
      });
      if (manager) {
        await prisma.user.update({
          where: { id: user.id },
          data: { managerId: manager.id },
        });
      }
    }

    // Everyone gets the learner baseline in addition to their functional roles,
    // except contractors, whose narrower role is intentional.
    const roleKeys = new Set<RoleKey>(spec.roles);
    if (!roleKeys.has(ROLE_KEYS.CONTRACTOR) && !roleKeys.has(ROLE_KEYS.AUDITOR)) {
      roleKeys.add(ROLE_KEYS.LEARNER);
    }

    await prisma.userRole.deleteMany({ where: { userId: user.id } });
    for (const key of roleKeys) {
      const roleId = roleIds.get(key);
      if (!roleId) continue;
      await prisma.userRole.create({ data: { userId: user.id, roleId } });
    }
  }

  const emails = specs.map((s) => s.email);
  const users = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true, email: true },
  });
  return new Map(users.map((u) => [u.email, u.id]));
}

async function seedSettings() {
  console.log("→ Application settings");
  const rows: { key: string; value: Prisma.InputJsonValue }[] = [
    {
      key: "brand",
      value: {
        companyName: "FSW Group",
        appName: "FSW Academy",
        primaryColor: "#17365c",
        secondaryColor: "#2575eb",
        accentColor: "#f98d07",
      },
    },
    {
      key: "features",
      value: {
        darkMode: false,
        publicCertificateVerification: false,
        leaderboards: false,
        selfEnrollment: true,
        gamificationBadges: true,
        scormPlayer: true,
        aiVideoStudio: true,
        translations: true,
      },
    },
    { key: "languages", value: ["en", "fil"] },
  ];

  for (const row of rows) {
    await prisma.appSetting.upsert({
      where: { key: row.key },
      create: { key: row.key, value: row.value, updatedBy: "seed" },
      update: {},
    });
  }
}

async function seedIntegrations() {
  console.log("→ Integration placeholders");
  const integrations = [
    { key: "microsoft365", name: "Microsoft 365" },
    { key: "teams", name: "Microsoft Teams" },
    { key: "slack", name: "Slack" },
    { key: "hris", name: "HRIS / Payroll" },
    { key: "google_workspace", name: "Google Workspace" },
    { key: "webhooks", name: "Webhooks" },
  ];

  for (const integration of integrations) {
    await prisma.integration.upsert({
      where: { key: integration.key },
      create: { ...integration, status: "NOT_CONNECTED" },
      update: { name: integration.name },
    });
  }
}

async function main() {
  console.log("Seeding FSW Academy…\n");

  const roleIds = await seedRoles();
  const org = await seedOrganization();
  const skillIds = await seedSkills();
  const positionIds = await seedPositions(org.departments, skillIds);
  const userIds = await seedPeople(
    roleIds,
    { welsford: org.welsford, valveman: org.valveman, shared: org.shared },
    org.departments,
    org.teams,
    positionIds,
    org.locations,
  );
  await seedSettings();
  await seedIntegrations();

  // Content seeding lives in seed-content.ts to keep this file navigable.
  const { seedSops, seedCourses, seedLearningPath, seedRulesAndCompliance, seedAnnouncements } =
    await import("./seed-content");

  const sopIds = await seedSops(prisma, DEMO_SOPS, userIds, org.departments, {
    welsford: org.welsford.id,
    valveman: org.valveman.id,
    shared: org.shared.id,
  });
  const courseIds = await seedCourses(prisma, DEMO_COURSES, userIds, skillIds, sopIds, org.departments);
  await seedLearningPath(prisma, DEMO_PATH, userIds, courseIds, sopIds);
  await seedRulesAndCompliance(prisma, userIds, courseIds, positionIds, sopIds);
  await seedAnnouncements(prisma, userIds);

  // Rules and content alone leave every learner surface empty. This runs the
  // real assignment engine and the real completion path so a fresh install has
  // truthful, demonstrable state on every screen.
  const { seedDemonstrationState } = await import("./seed-progress");
  await seedDemonstrationState(prisma, userIds, courseIds, sopIds);

  console.log("\nSeed complete.");
  console.log(`\nDevelopment sign-in password for every seeded account: ${DEV_PASSWORD}`);
  console.log("Accounts:");
  for (const [email] of userIds) {
    console.log(`  ${email}`);
  }
}

main()
  .catch((error) => {
    console.error("\nSeed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
