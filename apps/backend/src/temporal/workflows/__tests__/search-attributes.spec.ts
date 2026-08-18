// Lives here rather than beside `../../search-attributes.ts` only because this
// agent's write scope was limited to `workflows/__tests__/`; move it if you touch
// the sibling colocated specs (producer.service.spec.ts et al).
import { buildSearchAttributes } from '../../search-attributes';

describe('buildSearchAttributes', () => {
  it('sets both attributes for an org-scoped start', () => {
    expect(
      buildSearchAttributes({ organizationId: 'org-1', phase: 'analyzing' }),
    ).toEqual({ OrganizationId: ['org-1'], Phase: ['analyzing'] });
  });

  it('omits OrganizationId only when the key is absent (system-scoped work)', () => {
    expect(buildSearchAttributes({ phase: 'fetching' })).toEqual({
      Phase: ['fetching'],
    });
  });

  // Previously this silently dropped the key: the workflow still mutated
  // org-scoped rows but never appeared in that org's Running counts.
  it('throws when organizationId is present but empty', () => {
    expect(() =>
      buildSearchAttributes({
        organizationId: undefined,
        phase: 'fetching',
      }),
    ).toThrow(/organizationId key present but empty/);
    expect(() => buildSearchAttributes({ organizationId: '' })).toThrow(
      /organizationId key present but empty/,
    );
  });
});
