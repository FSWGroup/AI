import { describe, it, expect } from 'vitest';
import { isValidPin, isWeakPin, PIN_LENGTH } from '@/lib/kiosk';

describe('PIN format', () => {
  it('accepts exactly four digits', () => {
    expect(isValidPin('4071')).toBe(true);
    expect(PIN_LENGTH).toBe(4);
  });

  it('rejects anything that is not four digits', () => {
    for (const bad of ['', '123', '12345', 'abcd', '12a4', '  12', '1 23']) {
      expect(isValidPin(bad)).toBe(false);
    }
  });
});

describe('weak PIN rejection', () => {
  it('rejects repeats', () => {
    for (const pin of ['0000', '1111', '9999']) expect(isWeakPin(pin)).toBe(true);
  });

  it('rejects ascending and descending runs', () => {
    for (const pin of ['1234', '2345', '4321', '9876']) expect(isWeakPin(pin)).toBe(true);
  });

  it('rejects known keypad patterns', () => {
    expect(isWeakPin('2580')).toBe(true);
  });

  it('accepts an ordinary PIN', () => {
    for (const pin of ['4071', '8362', '1057', '6913']) expect(isWeakPin(pin)).toBe(false);
  });
});
