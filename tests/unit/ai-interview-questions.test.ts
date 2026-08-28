import { describe, it, expect } from 'vitest';
import { redactPersonalData, truncateForPrompt } from '@/lib/ai/redact';
import { screenQuestions, type InterviewQuestion } from '@/lib/ai/interview-questions';

const q = (question: string, extra: Partial<InterviewQuestion> = {}): InterviewQuestion => ({
  question,
  rationale: 'Because the role needs it.',
  listenFor: 'Concrete examples.',
  basis: 'BOTH',
  ...extra,
});

describe('résumé redaction', () => {
  it('removes email addresses', () => {
    const { text, removed } = redactPersonalData('Contact me at dana.okafor@example.com any time.');
    expect(text).not.toContain('dana.okafor@example.com');
    expect(text).toContain('[email removed]');
    expect(removed).toContain('email');
  });

  it('removes phone numbers in US and PH formats', () => {
    const us = redactPersonalData('Cell: 610-555-0100');
    expect(us.text).not.toContain('610-555-0100');
    const ph = redactPersonalData('Mobile: +63 917 555 0100');
    expect(ph.text).not.toContain('917 555 0100');
  });

  it('removes a US SSN', () => {
    const { text, removed } = redactPersonalData('SSN 123-45-6789 on file');
    expect(text).not.toContain('123-45-6789');
    expect(removed).toContain('ssn');
  });

  it('removes Philippine government identifiers', () => {
    const { text } = redactPersonalData('SSS 03-1234567-8, TIN 123-456-789-000');
    expect(text).not.toContain('03-1234567-8');
    expect(text).not.toContain('123-456-789-000');
  });

  it('removes a bank or card number', () => {
    const { text } = redactPersonalData('Account 4111 1111 1111 1111');
    expect(text).not.toContain('4111 1111 1111 1111');
  });

  it('removes a street address but keeps the city and state', () => {
    const { text } = redactPersonalData('123 Bridge Street, Exton, PA');
    expect(text).not.toContain('123 Bridge Street');
    expect(text).toContain('Exton, PA');
  });

  it('removes a stated date of birth', () => {
    const { text } = redactPersonalData('Date of birth: 15 May 1990\nSkills: welding');
    expect(text).not.toContain('15 May 1990');
    expect(text).toContain('Skills: welding');
  });

  it('leaves the actual experience intact', () => {
    const resume = 'Ran a 12-person warehouse team and cut pick errors by 30% using Prophet 21.';
    expect(redactPersonalData(resume).text).toBe(resume);
  });

  it('truncates a very long résumé', () => {
    const long = 'a'.repeat(20_000);
    const result = truncateForPrompt(long, 1000);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThan(1200);
    expect(truncateForPrompt('short', 1000).truncated).toBe(false);
  });
});

describe('protected-characteristic screening', () => {
  it('keeps ordinary job-related questions', () => {
    const { kept, dropped } = screenQuestions([
      q('Walk me through how you reduced pick errors in the warehouse.'),
      q('How do you price a non-standard valve assembly for a repeat customer?'),
      q('Tell me about a time an order shipped wrong. What did you change?'),
    ]);
    expect(kept).toHaveLength(3);
    expect(dropped).toHaveLength(0);
  });

  const forbidden: [string, string][] = [
    ['age', 'How old are you?'],
    ['born', 'What year were you born?'],
    ['graduat', 'What year did you graduate high school?'],
    ['ethnic', 'What is your ethnic background?'],
    ['citizen', 'Are you a US citizen by birth?'],
    ['disab', 'Do you have any disability we should know about?'],
    ['religio', 'Does your religion require Saturdays off?'],
    ['pregnan', 'Are you pregnant or planning to be?'],
    ['marital', 'What is your marital status?'],
    ['children', 'Do you have children at home?'],
    ['criminal', 'Have you ever been arrested?'],
    ['salary history', 'What is your salary history?'],
  ];

  it.each(forbidden)('drops a question touching %s', (_term, question) => {
    const { kept, dropped } = screenQuestions([q(question)]);
    expect(kept).toHaveLength(0);
    expect(dropped).toHaveLength(1);
  });

  it('screens the rationale and listen-for text too, not just the question', () => {
    const { kept } = screenQuestions([
      q('Tell me about your schedule flexibility.', { rationale: 'Checks whether childcare will be an issue.' }),
    ]);
    expect(kept).toHaveLength(0);
  });

  it('does not trip on words that merely contain a forbidden substring', () => {
    const { kept } = screenQuestions([
      q('How do you manage a backlog when leverage over the vendor is limited?'),
      q('Describe your approach to package tracking and average lead times.'),
    ]);
    expect(kept).toHaveLength(2);
  });
});
