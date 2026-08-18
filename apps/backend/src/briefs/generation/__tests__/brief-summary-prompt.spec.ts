import {
  BRIEF_SYSTEM_PROMPT,
  buildBriefUserPrompt,
  type BriefPromptCommit,
} from '../services/brief-summary-prompt';

// Half-open: Mon 2026-05-18 .. Sun 2026-05-24 inclusive, so `end` is the next
// local midnight after the last covered day.
const period = {
  start: new Date('2026-05-18T00:00:00Z'),
  end: new Date('2026-05-25T00:00:00Z'),
};

const commits: BriefPromptCommit[] = [
  {
    sha: 'abc123',
    authorName: 'Ada',
    authorEmail: 'ada@x.io',
    messageFirstLine: 'feat: notifications',
    analysis: {
      commitType: 'feature',
      summary: 'Add push notifications end-to-end',
      changes: ['Register device tokens', 'Deliver test push'],
    },
  },
  {
    sha: 'def456',
    authorName: 'Grace',
    authorEmail: 'grace@x.io',
    messageFirstLine: 'perf: cache checkout',
    analysis: null,
  },
];

describe('BRIEF_SYSTEM_PROMPT', () => {
  // The prompt asked for one cohesive paragraph until the summary was changed
  // to a lead sentence plus bullets; this assertion tracked the old shape and
  // had been failing since.
  it('asks for a lead sentence and then bullet points', () => {
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/clear and concise sentence/i);
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/bullet points/i);
  });
});

describe('buildBriefUserPrompt', () => {
  it('renders scope, period, and commit lines', () => {
    const out = buildBriefUserPrompt({
      scopeLabel: 'Project: Mobile',
      period,
      timezone: 'UTC',
      commits,
      maxChars: 10_000,
    });
    expect(out).toContain('Project: Mobile');
    expect(out).toContain('Period: May 18, 2026 – May 24, 2026');
    expect(out).toContain('[feature] Add push notifications end-to-end');
    expect(out).toContain('Register device tokens');
    expect(out).toContain('perf: cache checkout');
  });

  // The header was hardcoded to UTC while the boundaries are local midnights in
  // the schedule's zone, so an IST week starting Aug 3 00:00 IST (= Aug 2 18:30
  // UTC) went into the prompt as "Aug 2" and the model could repeat it.
  it('names the period in the brief’s own timezone, not UTC', () => {
    const out = buildBriefUserPrompt({
      scopeLabel: 'Project: Mobile',
      period: {
        start: new Date('2026-08-02T18:30:00Z'),
        end: new Date('2026-08-09T18:30:00Z'),
      },
      timezone: 'Asia/Kolkata',
      commits,
      maxChars: 10_000,
    });
    // Aug 3 00:00 IST -> Aug 10 00:00 IST exclusive, i.e. Aug 3 through Aug 9.
    // Neither the UTC start date (Aug 2) nor the exclusive end date (Aug 10).
    expect(out).toContain('Period: Aug 3, 2026 – Aug 9, 2026');
    expect(out).not.toContain('Aug 2, 2026');
    expect(out).not.toContain('Aug 10, 2026');
  });

  it('drops oldest commits and annotates omissions when over budget', () => {
    const many: BriefPromptCommit[] = Array.from({ length: 50 }, (_, i) => ({
      sha: `c${i}`,
      authorName: `A${i}`,
      authorEmail: `a${i}@x.io`,
      messageFirstLine: `commit ${i} with a reasonably long description that adds bulk`,
      analysis: null,
    }));
    const out = buildBriefUserPrompt({
      scopeLabel: 'Project: P',
      period,
      timezone: 'UTC',
      commits: many,
      maxChars: 800,
    });
    expect(out).toMatch(/\(\d+ commits omitted\)/);
    expect(out.length).toBeLessThanOrEqual(900);
  });
});

describe('BRIEF_SYSTEM_PROMPT highlights instruction', () => {
  // Nothing in the response shape carries a ranking, so ordering is the only
  // signal of importance the reader gets.
  it('demands most-important-first ordering', () => {
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/most important first/i);
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/the order is the ranking/i);
  });

  it('permits an empty highlight list rather than forcing invention', () => {
    expect(BRIEF_SYSTEM_PROMPT).toContain('empty list');
  });

  // "Judge importance by how much it affects users" was already in the prompt
  // and was ignored — a settings page outranked going to production, and a bug
  // that blocked multi-org customers was dropped entirely. The abstract
  // instruction is not enough; these are the concrete rules that replaced it.
  it('gives a ranking procedure rather than an abstract instruction', () => {
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/Name who is affected/i);
    expect(BRIEF_SYSTEM_PROMPT).toMatch(
      /how many people are affected first, then by how much changes for them/i,
    );
  });

  it('names the tie-breaks so equal-impact items get a stable order', () => {
    expect(BRIEF_SYSTEM_PROMPT).toMatch(
      /broken for people and now works beats/i,
    );
    expect(BRIEF_SYSTEM_PROMPT).toMatch(
      /a change people can see beats one they cannot/i,
    );
  });

  it('forbids the proxies the model actually ranked by', () => {
    expect(BRIEF_SYSTEM_PROMPT).toMatch(
      /Never rank by how recent the work is, how many commits it took/i,
    );
  });

  it('protects user-affecting fixes from being dropped as routine', () => {
    expect(BRIEF_SYSTEM_PROMPT).toMatch(
      /a fix that unblocks people is never routine/i,
    );
  });

  it('keeps business-enabling work in scope despite the no-internal-work rule', () => {
    expect(BRIEF_SYSTEM_PROMPT).toMatch(
      /running in production for the first time/i,
    );
  });

  it('bans unstated benefits and empty intensifiers', () => {
    expect(BRIEF_SYSTEM_PROMPT).toMatch(
      /never append a benefit, motive, or consequence/i,
    );
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/revamped, modernized/i);
  });

  // The schema no longer caps the array, so the prompt is the only thing
  // stopping the model from listing every commit it was given.
  it('sets no target count and demands selection over enumeration', () => {
    expect(BRIEF_SYSTEM_PROMPT).toContain('no target number of highlights');
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/not a list of everything/i);
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/leave out routine/i);
  });
});
