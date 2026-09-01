/**
 * Offer letter rendering: build the merge context, produce the text, and turn
 * it into a PDF with the existing document engine.
 *
 * The letter is frozen onto the offer when it is sent. What the candidate saw
 * is what the record shows, whatever anyone does to the template afterwards —
 * a template edit must never retroactively change an offer somebody accepted.
 */

import "server-only";
import { PdfBuilder, COLORS } from "@/lib/report/pdf-layout";
import { formatMoney, type OfferMergeContext } from "./offers";

export interface OfferForLetter {
  reference: string;
  jobTitle: string;
  departmentName: string | null;
  locationName: string | null;
  employmentType: string;
  workArrangement: string;
  baseSalary: number;
  salaryCurrency: string;
  salaryPeriod: string;
  signingBonus: number | null;
  variablePay: string | null;
  benefitsSummary: string | null;
  startDate: Date | null;
  expiresAt: Date | null;
}

export interface CandidateForLetter {
  firstName: string;
  lastName: string;
  email: string;
}

const dateFmt = (d: Date | null | undefined): string =>
  d
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(d)
    : "";

export function buildMergeContext(params: {
  offer: OfferForLetter;
  candidate: CandidateForLetter;
  companyName: string;
  hiringManagerName: string | null;
}): OfferMergeContext {
  const { offer, candidate } = params;
  return {
    candidateFirstName: candidate.firstName,
    candidateLastName: candidate.lastName,
    candidateFullName: `${candidate.firstName} ${candidate.lastName}`,
    candidateEmail: candidate.email,
    jobTitle: offer.jobTitle,
    departmentName: offer.departmentName ?? "",
    locationName: offer.locationName ?? "",
    employmentType: offer.employmentType.replace(/_/g, " ").toLowerCase(),
    workArrangement: offer.workArrangement.toLowerCase(),
    baseSalary: formatMoney(offer.baseSalary, offer.salaryCurrency),
    salaryCurrency: offer.salaryCurrency,
    salaryPeriod: offer.salaryPeriod.toLowerCase(),
    signingBonus:
      offer.signingBonus != null
        ? formatMoney(offer.signingBonus, offer.salaryCurrency)
        : "Not applicable",
    variablePay: offer.variablePay ?? "Not applicable",
    benefitsSummary: offer.benefitsSummary ?? "",
    startDate: dateFmt(offer.startDate),
    offerExpiryDate: dateFmt(offer.expiresAt),
    companyName: params.companyName,
    hiringManagerName: params.hiringManagerName ?? "",
    offerReference: offer.reference,
    todayDate: dateFmt(new Date()),
  };
}

/**
 * Render the frozen letter text as a PDF.
 *
 * Plain and unadorned on purpose: an offer letter is a legal document, and
 * the words are the employer's. The layout only has to be legible, printable,
 * and identical to the text the candidate accepted.
 */
export async function renderOfferLetterPdf(params: {
  letterBody: string;
  companyName: string;
  candidateName: string;
  offerReference: string;
  acceptance?: {
    signatureName: string;
    respondedAt: Date;
    ip: string | null;
  } | null;
}): Promise<Uint8Array> {
  const b = await PdfBuilder.create({
    header: `${params.companyName} — offer of employment`,
    headerRight: params.offerReference,
    footer: `${params.candidateName} · Confidential`,
  });

  b.moveDown(6);
  for (const paragraph of params.letterBody.split("\n")) {
    if (paragraph.trim() === "") {
      b.moveDown(7);
      continue;
    }
    // Lines that look like headings in the template are set apart.
    const isHeading = /^[A-Z][A-Z \-/&]{3,}$/.test(paragraph.trim());
    b.text(paragraph, {
      size: isHeading ? 10 : 10.5,
      bold: isHeading,
      color: isHeading ? COLORS.navy900 : COLORS.navy700,
      lineHeight: 1.5,
    });
  }

  if (params.acceptance) {
    b.moveDown(18);
    b.rule();
    b.moveDown(10);
    b.text("ACCEPTED", { size: 10, bold: true, color: COLORS.navy900 });
    b.moveDown(4);
    b.text(
      `Signed electronically by ${params.acceptance.signatureName} on ${new Intl.DateTimeFormat(
        "en-US",
        { dateStyle: "long", timeStyle: "short" },
      ).format(params.acceptance.respondedAt)}.`,
      { size: 9.5 },
    );
    if (params.acceptance.ip) {
      b.text(`Recorded from ${params.acceptance.ip}.`, {
        size: 8.5,
        color: COLORS.navy500,
      });
    }
  }

  return b.finish(`Offer — ${params.candidateName}`);
}
