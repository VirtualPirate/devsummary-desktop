/**
 * CLDR keeps renamed IANA zone ids frozen as its canonical ids, so
 * browsers (ICU) report e.g. `Asia/Calcutta` from
 * `Intl.DateTimeFormat().resolvedOptions().timeZone`, while Postgres
 * images without legacy tzdata links only recognize the modern IANA
 * names. This is the known divergence set; anything missed degrades to
 * a 400 via the repository's PG error translation, never a 500.
 */
const CLDR_LEGACY_TO_IANA: Record<string, string> = {
  'Africa/Asmera': 'Africa/Asmara',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'America/Catamarca': 'America/Argentina/Catamarca',
  'America/Coral_Harbour': 'America/Atikokan',
  'America/Cordoba': 'America/Argentina/Cordoba',
  'America/Godthab': 'America/Nuuk',
  'America/Indianapolis': 'America/Indiana/Indianapolis',
  'America/Jujuy': 'America/Argentina/Jujuy',
  'America/Louisville': 'America/Kentucky/Louisville',
  'America/Mendoza': 'America/Argentina/Mendoza',
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Europe/Kiev': 'Europe/Kyiv',
  'Pacific/Enderbury': 'Pacific/Kanton',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Truk': 'Pacific/Chuuk',
};

export function normalizeIanaTimeZone(timeZone: string): string {
  return CLDR_LEGACY_TO_IANA[timeZone] ?? timeZone;
}

/**
 * True only for a real IANA zone id. Constructing a `DateTimeFormat` is not
 * enough on its own: Node accepts a fixed offset like `'+05:30'` as a timeZone.
 * Postgres accepts offset strings in `AT TIME ZONE` too, but with INVERTED sign
 * semantics, so such a value reaching the activity report would bucket silently
 * wrong instead of raising the 22023 that path is prepared for.
 *
 * Canonicalizing first is what keeps every id already in the database valid: it
 * resolves links (`US/Pacific` -> `America/Los_Angeles`) and the CLDR-frozen
 * spellings (`Asia/Kolkata` -> `Asia/Calcutta`, which is the one
 * `supportedValuesOf` actually lists). `normalizeIanaTimeZone` covers the same
 * divergence in the other direction, for an ICU whose list holds the modern
 * names. An offset canonicalizes to itself and is in neither.
 */
export function isIanaTimeZone(timeZone: string): boolean {
  let canonical: string;
  try {
    canonical = new Intl.DateTimeFormat('en-US', {
      timeZone,
    }).resolvedOptions().timeZone;
  } catch {
    return false;
  }
  const iana = Intl.supportedValuesOf('timeZone');
  return (
    canonical === 'UTC' || // resolved from UTC/GMT/Etc/UTC; not in the list
    iana.includes(canonical) ||
    iana.includes(normalizeIanaTimeZone(canonical))
  );
}
