/**
 * Verify the SignNow adapter against a real account.
 *
 * WHY THIS EXISTS: the adapter in src/lib/esign/signnow.ts was written from
 * SignNow's documented API but never exercised against the live service —
 * network egress to their docs was blocked when it was built. This script
 * calls each endpoint in order and names the first one that fails, so a wrong
 * path or field name is a one-line fix in the ENDPOINTS block rather than a
 * hunt.
 *
 * RUN IT AGAINST THE EVALUATION ENVIRONMENT FIRST:
 *   SIGNNOW_API_BASE="https://api-eval.signnow.com"
 * A sandbox key pointed at production would send real invites to real people.
 *
 * Put the credentials in a local .env that never leaves your machine.
 * Usage: npx tsx scripts/verify-signnow.ts you@yourcompany.com
 */
import 'dotenv/config';
import { SignNowProvider, parseSignNowEvent } from '../src/lib/esign/signnow';

let failures = 0;
const check = (label: string, pass: boolean, detail = '') => {
  console.log(`${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures++;
};

/** A minimal valid one-page PDF, so nothing external is needed. */
function tinyPdf(): Buffer {
  const content = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<<>>>>endobj
trailer<</Root 1 0 R>>
%%EOF`;
  return Buffer.from(content, 'latin1');
}

async function main() {
  const signerEmail = process.argv[2];
  if (!signerEmail) {
    console.log('Usage: npx tsx scripts/verify-signnow.ts <signer-email>');
    console.log('Use an address you control — this creates a real signature invite.');
    process.exit(1);
  }

  const base = process.env.SIGNNOW_API_BASE ?? 'https://api.signnow.com';
  console.log(`Environment: ${base}`);
  if (!base.includes('eval')) {
    console.log('⚠  This is the PRODUCTION host. Invites sent here are real.\n');
  }

  const provider = new SignNowProvider();
  check('credentials are present in the environment', provider.isConfigured());
  if (!provider.isConfigured()) {
    console.log('\nSet SIGNNOW_CLIENT_ID, SIGNNOW_CLIENT_SECRET, SIGNNOW_USERNAME and SIGNNOW_PASSWORD.');
    process.exit(1);
  }

  let providerDocumentId = '';
  try {
    console.log('\n1. Upload a document and create an embedded invite…');
    const created = await provider.createRequest({
      file: tinyPdf(),
      fileName: 'fsw-people-verification.pdf',
      documentTitle: 'FSW People adapter verification',
      signerName: 'Verification Signer',
      signerEmail,
      message: 'Automated verification of the FSW People SignNow adapter. Safe to decline.',
    });
    providerDocumentId = created.providerDocumentId;
    check('createRequest returned a document id', Boolean(created.providerDocumentId), created.providerDocumentId);
    check('createRequest returned an invite id', Boolean(created.providerInviteId), created.providerInviteId ?? 'none');
  } catch (error) {
    check('createRequest', false, error instanceof Error ? error.message : String(error));
    console.log('\nFix: check ENDPOINTS.uploadDocument and ENDPOINTS.embeddedInvite in src/lib/esign/signnow.ts');
    process.exit(1);
  }

  try {
    console.log('\n2. Mint a signing link…');
    const link = await provider.signingLink(providerDocumentId, signerEmail);
    check('signingLink returned a URL', link.url.startsWith('http'), link.url.slice(0, 60) + '…');
    check('the link carries an expiry', link.expiresAt > new Date());
  } catch (error) {
    check('signingLink', false, error instanceof Error ? error.message : String(error));
    console.log('Fix: check ENDPOINTS.embeddedInviteLink and firstInviteId()');
  }

  try {
    console.log('\n3. Download the document and its certificate…');
    const artifacts = await provider.downloadSigned(providerDocumentId);
    check('downloadSigned returned a PDF', artifacts.pdf.length > 0, `${artifacts.pdf.length} bytes`);
    check(
      'downloadSigned returned an audit certificate',
      artifacts.certificate !== null,
      artifacts.certificate ? `${artifacts.certificate.length} bytes` : 'none — check ENDPOINTS.historyDownload',
    );
  } catch (error) {
    check('downloadSigned', false, error instanceof Error ? error.message : String(error));
    console.log('Fix: check ENDPOINTS.download and ENDPOINTS.historyDownload');
  }

  console.log('\n4. Webhook parsing (offline — no call made)…');
  const parsed = parseSignNowEvent({
    event: 'document.complete',
    event_id: 'evt_verify',
    timestamp: Math.floor(Date.now() / 1000),
    content: { document_id: providerDocumentId },
  });
  check('a completion payload parses', parsed?.kind === 'SIGNED');
  console.log(
    '\n  NOTE: compare a REAL webhook body from your SignNow dashboard against\n' +
      '  EVENT_MAP and parseSignNowEvent(). The event names and payload shape are\n' +
      '  the most likely thing to differ from what was written blind.',
  );

  try {
    console.log('\n5. Cancel the verification document…');
    await provider.cancel(providerDocumentId);
    check('cancel succeeded', true);
  } catch (error) {
    check('cancel', false, error instanceof Error ? error.message : String(error));
  }

  console.log(
    failures === 0
      ? '\nSIGNNOW ADAPTER VERIFIED'
      : `\n${failures} check(s) failed — each names the ENDPOINTS entry to correct.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
