import { csvCell, csvRow } from '@/application/audit/audit.service';

describe('CSV cell/row escaping (T-25)', () => {
  it('leaves plain values unquoted', () => {
    expect(csvCell('deposit')).toBe('deposit');
    expect(csvCell('1000.0000')).toBe('1000.0000');
    expect(csvCell('2026-08-11T18:00:00.000Z')).toBe('2026-08-11T18:00:00.000Z');
  });

  it('quotes fields containing commas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
  });

  it('doubles embedded quotes and wraps the field', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('wraps fields containing newlines', () => {
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('builds a CRLF-terminated row from escaped cells', () => {
    expect(csvRow(['a', 'b,c', 'd"e'])).toBe('a,"b,c","d""e"\r\n');
  });
});
