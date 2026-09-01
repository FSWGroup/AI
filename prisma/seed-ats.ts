/**
 * Recruiting seed: source channels, rejection reasons, a default offer letter
 * template, candidate email templates, and one worked example requisition.
 *
 * The offer letter template is deliberately a skeleton with the legally
 * significant clauses left as bracketed prompts. FSW's counsel writes those
 * words; the platform supplies the merge mechanism.
 */

import { PrismaClient } from "@prisma/client";
import { SEED_CHANNELS } from "../src/lib/ats/sources";
import { DEFAULT_PIPELINE } from "../src/lib/ats/stages";

const prisma = new PrismaClient();

const REJECTION_REASONS = [
  { label: "Does not meet minimum qualifications", category: "QUALIFICATIONS", orderIndex: 0 },
  { label: "Experience not aligned to the role", category: "EXPERIENCE", orderIndex: 1 },
  { label: "Stronger candidates in the pipeline", category: "PROCESS", orderIndex: 2 },
  { label: "Interview did not demonstrate required competencies", category: "EXPERIENCE", orderIndex: 3 },
  { label: "Compensation expectations outside range", category: "COMPENSATION", orderIndex: 4 },
  { label: "Candidate withdrew", category: "CANDIDATE_DRIVEN", notifyCandidate: false, orderIndex: 5 },
  { label: "Candidate unresponsive", category: "CANDIDATE_DRIVEN", orderIndex: 6 },
  { label: "Position closed or on hold", category: "PROCESS", orderIndex: 7 },
  { label: "Other", category: "OTHER", orderIndex: 8 },
];

const EMAIL_TEMPLATES = [
  {
    key: "application_received",
    name: "Application received",
    subject: "We received your application for {{jobTitle}}",
    body: `Hi {{candidateFirstName}},

Thanks for applying for {{jobTitle}} at {{companyName}}. Your application is with our recruiting team and we will be in touch about next steps.

Your reference is {{applicationReference}} — quote it if you need to contact us about this application.

{{companyName}} Recruiting`,
  },
  {
    key: "rejection",
    name: "Not moving forward",
    subject: "Your application for {{jobTitle}}",
    body: `Hi {{candidateFirstName}},

Thank you for the time you put into applying for {{jobTitle}} at {{companyName}}. After review we are not moving forward with your application for this role.

We know how much effort an application takes and we are grateful for yours. You are welcome to apply for future openings that fit your experience.

{{companyName}} Recruiting`,
  },
  {
    key: "interview_invitation",
    name: "Interview invitation",
    subject: "Interview for {{jobTitle}} — {{interviewTitle}}",
    body: `Hi {{candidateFirstName}},

We would like to invite you to {{interviewTitle}} for the {{jobTitle}} role.

When: {{interviewDateTime}}
Where: {{interviewLocation}}

If that time does not work, reply to this email and we will find another.

{{companyName}} Recruiting`,
  },
  {
    key: "offer_sent",
    name: "Offer sent",
    subject: "Your offer from {{companyName}}",
    body: `Hi {{candidateFirstName}},

We are delighted to offer you the {{jobTitle}} role at {{companyName}}. You can read the full offer and respond here:

{{offerUrl}}

This offer is open until {{offerExpiryDate}}. If you have questions before responding, reply to this email.

{{companyName}} Recruiting`,
  },
];

const OFFER_TEMPLATE = `{{todayDate}}

{{candidateFullName}}
{{candidateEmail}}

Dear {{candidateFirstName}},

{{companyName}} is pleased to offer you the position of {{jobTitle}} in our {{departmentName}} team, based at {{locationName}}.

POSITION
Title: {{jobTitle}}
Employment type: {{employmentType}}
Work arrangement: {{workArrangement}}
Reporting to: {{hiringManagerName}}
Proposed start date: {{startDate}}

COMPENSATION
Base salary: {{baseSalary}} per {{salaryPeriod}}
Signing bonus: {{signingBonus}}
Variable pay: {{variablePay}}

BENEFITS
{{benefitsSummary}}

[TERMS AND CONDITIONS — replace this section with your organization's
standard employment terms, reviewed by counsel. It typically covers the
probationary period, notice, statutory benefits and contributions, working
hours, confidentiality, and the conditions this offer depends on such as
background and reference checks and proof of right to work.]

This offer is open until {{offerExpiryDate}}. To accept, use the link in the
email accompanying this letter.

We are looking forward to working with you.

{{companyName}}
Offer reference: {{offerReference}}`;

async function main(): Promise<void> {
  for (const channel of SEED_CHANNELS) {
    await prisma.sourceChannel.upsert({
      where: { key: channel.key },
      create: channel,
      update: { name: channel.name, category: channel.category },
    });
  }
  console.log(`Source channels ready (${SEED_CHANNELS.length}).`);

  for (const reason of REJECTION_REASONS) {
    await prisma.rejectionReason.upsert({
      where: { label: reason.label },
      create: reason,
      update: { category: reason.category, orderIndex: reason.orderIndex },
    });
  }
  console.log(`Rejection reasons ready (${REJECTION_REASONS.length}).`);

  for (const t of EMAIL_TEMPLATES) {
    await prisma.recruitingEmailTemplate.upsert({
      where: { key: t.key },
      create: t,
      update: {},
    });
  }
  console.log(`Candidate email templates ready (${EMAIL_TEMPLATES.length}).`);

  await prisma.offerLetterTemplate.upsert({
    where: { name: "Standard offer (needs legal review)" },
    create: { name: "Standard offer (needs legal review)", body: OFFER_TEMPLATE },
    update: {},
  });
  console.log("Offer letter template ready.");

  const department = await prisma.department.upsert({
    where: { name: "Sales" },
    create: { name: "Sales" },
    update: {},
  });
  const location = await prisma.location.upsert({
    where: { name_country: { name: "Manila", country: "PH" } },
    create: { name: "Manila", city: "Manila", region: "NCR", country: "PH" },
    update: {},
  });

  // A worked example wired to the existing assessment benchmark, so the
  // pipeline has something in it on a fresh install.
  const profile = await prisma.jobProfile.findFirst({
    where: { name: "Welsford Inside Technical Sales" },
    include: { openings: true },
  });
  if (profile) {
    const existing = await prisma.requisition.findFirst({
      where: { title: "Inside Technical Sales Representative" },
    });
    if (!existing) {
      const requisition = await prisma.requisition.create({
        data: {
          reference: "REQ-SALES01",
          title: "Inside Technical Sales Representative",
          status: "OPEN",
          departmentId: department.id,
          locationId: location.id,
          employmentType: "FULL_TIME",
          workArrangement: "HYBRID",
          openings: 2,
          salaryMin: 35000,
          salaryMax: 55000,
          salaryCurrency: "PHP",
          salaryPeriod: "MONTH",
          salaryPublish: true,
          summary:
            "Sell technical products to business customers over the phone and by email, from first contact through to close.",
          description:
            "You will own a book of inbound and outbound opportunities for our technical product line, working with customers who know their problem but not yet the solution.",
          responsibilities:
            "Qualify inbound enquiries and follow up on outbound campaigns.\nUnderstand a customer's technical requirement well enough to recommend a fit.\nKeep opportunity records current so forecasts mean something.\nWork with the technical team on quotes and specifications.",
          requirements:
            "Comfortable holding a technical conversation and asking questions until you understand the requirement.\nOrganized enough to keep a pipeline of thirty-plus live opportunities straight.\nResilient about rejection, because most calls end in no.",
          benefits:
            "HMO from day one, statutory contributions, thirteenth month, and a hybrid schedule after onboarding.",
          jobProfileId: profile.id,
          jobOpeningId: profile.openings[0]?.id ?? null,
          openedAt: new Date(),
        },
      });
      await prisma.pipelineStage.createMany({
        data: DEFAULT_PIPELINE.map((s, i) => ({
          requisitionId: requisition.id,
          name: s.name,
          kind: s.kind,
          orderIndex: i,
        })),
      });
      await prisma.screeningQuestion.createMany({
        data: [
          {
            requisitionId: requisition.id,
            prompt: "How many years have you worked in a sales role?",
            kind: "NUMBER",
            required: true,
            orderIndex: 0,
            knockout: true,
            knockoutOperator: "MIN",
            knockoutValue: "1",
            helpText: "Any sales role counts, including retail and call centre.",
          },
          {
            requisitionId: requisition.id,
            prompt: "Are you legally authorized to work in the Philippines?",
            kind: "YES_NO",
            required: true,
            orderIndex: 1,
            knockout: true,
            knockoutOperator: "EQUALS",
            knockoutValue: "Yes",
          },
          {
            requisitionId: requisition.id,
            prompt: "What interests you about technical sales specifically?",
            kind: "LONG_TEXT",
            required: false,
            orderIndex: 2,
          },
        ],
      });
      console.log(`Example requisition created: ${requisition.reference}.`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
