import { ListBriefsQuerySchema } from '@launchstack/api-interfaces';

// The schema receives raw query-string values (all strings). These tests pin
// the coercion/validation behaviour of the new filter params.
describe('ListBriefsQuerySchema new filter params', () => {
  it("coerces excludeNoActivity 'true' to boolean true", () => {
    const parsed = ListBriefsQuerySchema.parse({
      excludeNoActivity: 'true',
    }) as Record<string, unknown>;
    expect(parsed.excludeNoActivity).toBe(true);
  });

  it("coerces excludeNoActivity 'false' to boolean false", () => {
    const parsed = ListBriefsQuerySchema.parse({
      excludeNoActivity: 'false',
    }) as Record<string, unknown>;
    expect(parsed.excludeNoActivity).toBe(false);
  });

  it('leaves excludeNoActivity undefined when absent', () => {
    const parsed = ListBriefsQuerySchema.parse({}) as Record<string, unknown>;
    expect(parsed.excludeNoActivity).toBeUndefined();
  });

  it('accepts ISO datetime from/to', () => {
    const parsed = ListBriefsQuerySchema.parse({
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-08T00:00:00.000Z',
    }) as Record<string, unknown>;
    expect(parsed.from).toBe('2026-06-01T00:00:00.000Z');
    expect(parsed.to).toBe('2026-06-08T00:00:00.000Z');
  });

  it('rejects a non-datetime from value', () => {
    expect(() => ListBriefsQuerySchema.parse({ from: 'not-a-date' })).toThrow();
  });
});
