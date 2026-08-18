import { normalizeIanaTimeZone } from '../lib/timezone-aliases';

describe('normalizeIanaTimeZone', () => {
  it('maps CLDR-legacy ids to modern IANA ids', () => {
    expect(normalizeIanaTimeZone('Asia/Calcutta')).toBe('Asia/Kolkata');
    expect(normalizeIanaTimeZone('Asia/Saigon')).toBe('Asia/Ho_Chi_Minh');
    expect(normalizeIanaTimeZone('Europe/Kiev')).toBe('Europe/Kyiv');
    expect(normalizeIanaTimeZone('America/Buenos_Aires')).toBe(
      'America/Argentina/Buenos_Aires',
    );
  });

  it('passes modern ids through unchanged', () => {
    expect(normalizeIanaTimeZone('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(normalizeIanaTimeZone('UTC')).toBe('UTC');
    expect(normalizeIanaTimeZone('America/New_York')).toBe('America/New_York');
  });

  it('passes unknown ids through unchanged (PG error translation is the net)', () => {
    expect(normalizeIanaTimeZone('Mars/Olympus_Mons')).toBe(
      'Mars/Olympus_Mons',
    );
  });
});
