import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createUser, freshDatabase, testPrisma } from "./helpers";
import { ROLE_KEYS } from "@/lib/permissions";
import { renderCertificatePdf } from "@/lib/services/certificate";

/**
 * Certificate generation.
 *
 * A certificate is the artefact a person shows to prove they were trained, so
 * "the download button produces a real, openable PDF" is a functional
 * requirement rather than a nicety. These tests assert the bytes, not just that
 * the function returned without throwing.
 */

beforeEach(async () => {
  await freshDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});


/**
 * Extract the text drawn on a PDF's pages.
 *
 * pdf-lib Flate-compresses content streams, so the drawn strings are not
 * present in the raw bytes. This inflates every FlateDecode stream and pulls out
 * the string literals from the text-showing operators, which is what actually
 * proves a value reached the page rather than merely reaching the function.
 */
async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const zlib = await import("node:zlib");
  const buffer = Buffer.from(bytes);
  const parts: string[] = [];

  // Walk every "stream ... endstream" span and inflate the ones that succeed.
  let searchFrom = 0;
  for (;;) {
    const start = buffer.indexOf("stream", searchFrom);
    if (start === -1) break;
    const end = buffer.indexOf("endstream", start);
    if (end === -1) break;

    // Skip the "stream" keyword and its trailing EOL.
    let dataStart = start + "stream".length;
    if (buffer[dataStart] === 0x0d) dataStart += 1;
    if (buffer[dataStart] === 0x0a) dataStart += 1;

    const chunk = buffer.subarray(dataStart, end);
    try {
      parts.push(zlib.inflateSync(chunk).toString("latin1"));
    } catch {
      // Not a Flate stream (or not a stream at all) — ignore it.
      parts.push(chunk.toString("latin1"));
    }
    searchFrom = end + "endstream".length;
  }

  const content = parts.join("\n");

  const shown: string[] = [];

  // A PDF string is either a literal — (text) with backslash escapes — or a hex
  // string, <48656C6C6F>. pdf-lib emits hex, so both forms must be handled.
  const decodeLiteral = (raw: string): string =>
    raw
      .replace(/\\(\d{1,3})/g, (_full, octal: string) => String.fromCharCode(parseInt(octal, 8)))
      .replace(/\\([()\\])/g, "$1");

  const decodeHex = (raw: string): string => {
    const clean = raw.replace(/\s+/g, "");
    // An odd trailing nibble is padded with 0 per the PDF spec.
    const padded = clean.length % 2 === 1 ? `${clean}0` : clean;
    let out = "";
    for (let i = 0; i < padded.length; i += 2) {
      out += String.fromCharCode(parseInt(padded.slice(i, i + 2), 16));
    }
    return out;
  };

  // Any string immediately followed by a text-showing operator, or appearing
  // inside a TJ array.
  const stringPattern = /\(((?:\\.|[^\\)])*)\)|<([0-9A-Fa-f\s]*)>/g;
  for (const match of content.matchAll(stringPattern)) {
    if (match[1] !== undefined) shown.push(decodeLiteral(match[1]));
    else if (match[2] !== undefined) shown.push(decodeHex(match[2]));
  }

  return shown.join(" ");
}

async function createCertificate(options: {
  userId: string;
  userName?: string;
  courseTitle?: string;
  expiresAt?: Date | null;
  instructorName?: string | null;
}): Promise<string> {
  const cert = await testPrisma.certificate.create({
    data: {
      certificateNumber: `FSW-2026-${Math.floor(Math.random() * 900000 + 100000)}`,
      userId: options.userId,
      userNameSnapshot: options.userName ?? "Jordan Pace",
      courseTitleSnapshot: options.courseTitle ?? "Cybersecurity Fundamentals",
      expiresAt: options.expiresAt ?? null,
      instructorName: options.instructorName ?? null,
    },
    select: { id: true },
  });
  return cert.id;
}

describe("certificate PDF rendering", () => {
  it("produces bytes with a valid PDF header and EOF marker", async () => {
    const userId = await createUser({ email: "cert@test.local", roles: [ROLE_KEYS.LEARNER] });
    const certificateId = await createCertificate({ userId });

    const bytes = await renderCertificatePdf(certificateId);
    const buffer = Buffer.from(bytes);

    // A file that opens in a PDF reader starts with %PDF- and ends with %%EOF.
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buffer.subarray(-2048).toString("latin1")).toContain("%%EOF");

    // Not a stub: a single-page certificate with text and vector graphics is
    // comfortably over a kilobyte.
    expect(buffer.byteLength).toBeGreaterThan(1000);
  });

  it("embeds the person's name, the course title, and the certificate number", async () => {
    const userId = await createUser({ email: "cert2@test.local", roles: [ROLE_KEYS.LEARNER] });
    const certificateId = await createCertificate({
      userId,
      userName: "Jordan Pace",
      courseTitle: "Warehouse Safety and Receiving",
    });

    const record = await testPrisma.certificate.findUniqueOrThrow({
      where: { id: certificateId },
      select: { certificateNumber: true },
    });

    const text = await extractPdfText(await renderCertificatePdf(certificateId));

    expect(text).toContain("Jordan Pace");
    expect(text).toContain("Warehouse Safety");
    expect(text).toContain(record.certificateNumber);
  });

  it("includes the expiry date when the certificate expires", async () => {
    const userId = await createUser({ email: "cert3@test.local", roles: [ROLE_KEYS.LEARNER] });
    const certificateId = await createCertificate({
      userId,
      expiresAt: new Date("2027-08-28T00:00:00Z"),
    });

    const text = await extractPdfText(await renderCertificatePdf(certificateId));
    expect(text).toMatch(/2027/);
  });

  it("includes the instructor when one is recorded", async () => {
    const userId = await createUser({ email: "cert4@test.local", roles: [ROLE_KEYS.LEARNER] });
    const certificateId = await createCertificate({
      userId,
      instructorName: "Rosa Delgado",
    });

    const text = await extractPdfText(await renderCertificatePdf(certificateId));
    expect(text).toContain("Rosa Delgado");
  });

  it("renders a certificate with no expiry and no instructor", async () => {
    const userId = await createUser({ email: "cert5@test.local", roles: [ROLE_KEYS.LEARNER] });
    const certificateId = await createCertificate({
      userId,
      expiresAt: null,
      instructorName: null,
    });

    // The optional fields being absent must not break rendering.
    const buffer = Buffer.from(await renderCertificatePdf(certificateId));
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buffer.byteLength).toBeGreaterThan(1000);
  });

  it("handles a long course title without failing", async () => {
    const userId = await createUser({ email: "cert6@test.local", roles: [ROLE_KEYS.LEARNER] });
    const certificateId = await createCertificate({
      userId,
      courseTitle:
        "Advanced Technical Product Selection for Control Valves, Actuation, and " +
        "Instrumentation in High-Temperature Industrial Process Applications",
    });

    const buffer = Buffer.from(await renderCertificatePdf(certificateId));
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("handles a name with non-ASCII characters", async () => {
    const userId = await createUser({ email: "cert7@test.local", roles: [ROLE_KEYS.LEARNER] });
    const certificateId = await createCertificate({
      userId,
      userName: "José Álvarez-Muñoz",
    });

    // Standard PDF fonts cannot encode every codepoint; rendering must not throw.
    const buffer = Buffer.from(await renderCertificatePdf(certificateId));
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buffer.byteLength).toBeGreaterThan(1000);
  });

  it("throws a clear error for an unknown certificate", async () => {
    await expect(renderCertificatePdf("does-not-exist")).rejects.toThrow();
  });
});

describe("certificate records", () => {
  it("keeps snapshots so the PDF stays accurate after the person is renamed", async () => {
    const userId = await createUser({
      email: "cert8@test.local",
      name: "Original Name",
      roles: [ROLE_KEYS.LEARNER],
    });
    const certificateId = await createCertificate({ userId, userName: "Original Name" });

    await testPrisma.user.update({ where: { id: userId }, data: { name: "Changed Name" } });

    const text = await extractPdfText(await renderCertificatePdf(certificateId));
    // The certificate attests to who completed the training at the time.
    expect(text).toContain("Original Name");
    expect(text).not.toContain("Changed Name");
  });

  it("does not expose a public verification token by default", async () => {
    const userId = await createUser({ email: "cert9@test.local", roles: [ROLE_KEYS.LEARNER] });
    const certificateId = await createCertificate({ userId });

    const record = await testPrisma.certificate.findUniqueOrThrow({
      where: { id: certificateId },
      select: { verificationToken: true },
    });

    // Public verification is opt-in; a certificate must not be checkable by a
    // stranger unless an administrator enabled it.
    expect(record.verificationToken).toBeNull();
  });

  it("records revocation without deleting the certificate", async () => {
    const userId = await createUser({ email: "cert10@test.local", roles: [ROLE_KEYS.LEARNER] });
    const certificateId = await createCertificate({ userId });

    await testPrisma.certificate.update({
      where: { id: certificateId },
      data: { revokedAt: new Date(), revokedReason: "Issued against the wrong course version" },
    });

    const record = await testPrisma.certificate.findUniqueOrThrow({
      where: { id: certificateId },
      select: { revokedAt: true, revokedReason: true, certificateNumber: true },
    });

    // The record survives so the history of issuance and revocation is intact.
    expect(record.revokedAt).toBeInstanceOf(Date);
    expect(record.revokedReason).toContain("wrong course version");
    expect(record.certificateNumber).toBeTruthy();
  });
});
