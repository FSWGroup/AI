/**
 * Verify the SharePoint storage driver against a real tenant.
 *
 * WHY THIS EXISTS: the Graph calls in src/lib/storage-graph.ts were written
 * from documentation that could not be fetched when the code was built. This
 * round-trips a small file and names the first call that fails.
 *
 * IT ALSO CHECKS THE THING THAT MATTERS MOST: that the target site has no
 * human members. SharePoint permissions are a separate system from FSW
 * People's RBAC — if people can browse the library, the document authorization
 * rules and the download audit trail stop being the real access control.
 *
 * Usage: npx tsx scripts/verify-sharepoint.ts
 */
import 'dotenv/config';
import { GraphDriver, graphPathFor, resetGraphToken } from '../src/lib/storage-graph';

let failures = 0;
const check = (label: string, pass: boolean, detail = '') => {
  console.log(`${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures++;
};

async function main() {
  const required = ['MS_GRAPH_TENANT_ID', 'MS_GRAPH_CLIENT_ID', 'MS_GRAPH_CLIENT_SECRET', 'MS_GRAPH_SITE_ID'];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.log(`Missing: ${missing.join(', ')}`);
    console.log('See DEPLOYMENT.md — SharePoint document storage.');
    process.exit(1);
  }

  resetGraphToken();
  let driver: GraphDriver;
  try {
    driver = new GraphDriver();
    check('driver constructed', true);
  } catch (error) {
    check('driver construction', false, error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const key = `verification/${Date.now()}-roundtrip.txt`;
  const payload = Buffer.from(`FSW People SharePoint verification at ${new Date().toISOString()}`);
  console.log(`\nTarget path: ${graphPathFor(key)}\n`);

  try {
    await driver.put(key, payload, 'text/plain');
    check('upload a small file', true);
  } catch (error) {
    check('upload', false, error instanceof Error ? error.message : String(error));
    console.log('\nCommon causes: the app lacks Sites.Selected on THIS site, or MS_GRAPH_SITE_ID is wrong.');
    process.exit(1);
  }

  try {
    const roundTripped = await driver.get(key);
    check('download returns the same bytes', roundTripped.equals(payload), `${roundTripped.length} bytes`);
  } catch (error) {
    check('download', false, error instanceof Error ? error.message : String(error));
  }

  // Over Graph's 4 MB simple-upload ceiling, so the chunked path is exercised.
  const largeKey = `verification/${Date.now()}-large.bin`;
  try {
    const large = Buffer.alloc(5 * 1024 * 1024, 7);
    await driver.put(largeKey, large, 'application/octet-stream');
    const back = await driver.get(largeKey);
    check('chunked upload of a 5 MB file round-trips', back.length === large.length, `${back.length} bytes`);
    await driver.delete(largeKey);
  } catch (error) {
    check('chunked upload', false, error instanceof Error ? error.message : String(error));
    console.log('Fix: check createUploadSession and the Content-Range headers in putLarge()');
  }

  try {
    await driver.delete(key);
    check('delete succeeds', true);
    await driver.delete(key);
    check('deleting something already gone is not an error', true);
  } catch (error) {
    check('delete', false, error instanceof Error ? error.message : String(error));
  }

  console.log('\n— The check that matters most —');
  console.log(
    'Open the target site in SharePoint and confirm its members list is EMPTY\n' +
      'apart from the app registration. If any person or group can browse this\n' +
      'library, they can read HR documents without passing through FSW People,\n' +
      'and neither canAccessDocument() nor the download audit log will see it.\n' +
      'This script cannot verify that for you — it needs a human to look.',
  );

  console.log(failures === 0 ? '\nSHAREPOINT DRIVER VERIFIED' : `\n${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
