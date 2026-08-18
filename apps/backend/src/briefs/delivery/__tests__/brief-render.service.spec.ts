import { BriefRenderService } from '../services/brief-render.service';
import { APP_URL, brief, report } from './report.fixture';

const svc = new BriefRenderService();

/** The mrkdwn/plain_text of every block, flattened — blocks nest three ways. */
function allText(blocks: Array<Record<string, unknown>>): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      if (typeof obj.text === 'string') out.push(obj.text);
      Object.values(obj).forEach(walk);
    }
  };
  walk(blocks);
  return out;
}

describe('BriefRenderService', () => {
  it('toSlackMarkdown produces title bolded + info italic + summary', () => {
    const md = svc.toSlackMarkdown(brief);
    expect(md.startsWith('*Mobile shipped notifications*')).toBe(true);
    expect(md).toContain(`_${brief.briefInfoTitle}_`);
    expect(md).toContain(brief.summary);
  });
});

describe('BriefRenderService.toSlackBlocks', () => {
  it('opens with the title and closes with a link to the full report', () => {
    const blocks = svc.toSlackBlocks(brief, report(), APP_URL);
    expect(blocks[0]).toMatchObject({
      type: 'header',
      text: { text: 'Mobile shipped notifications' },
    });
    expect(blocks[blocks.length - 1]).toMatchObject({
      type: 'actions',
      elements: [{ url: `${APP_URL}/briefs/b1` }],
    });
  });

  it('does not double the slash when FRONTEND_URL has a trailing one', () => {
    const blocks = svc.toSlackBlocks(brief, report(), `${APP_URL}/`);
    expect(blocks[blocks.length - 1]).toMatchObject({
      elements: [{ url: `${APP_URL}/briefs/b1` }],
    });
  });

  it('renders totals, highlights and both charts', () => {
    const text = allText(svc.toSlackBlocks(brief, report(), APP_URL)).join(
      '\n',
    );
    expect(text).toContain('*Commits*\n24  ↑31%');
    expect(text).toContain('*Contributors*\n3  ↑2');
    expect(text).toContain('*Repositories*\n2 of 5');
    expect(text).toContain('*Lines*\n+12,431 / −3,880');
    expect(text).toContain('• *Push notifications are live*');
    expect(text).toContain('features');
    expect(text).toContain('acme/api');
  });

  it('pads bar labels to a fixed width so the fenced chart lines up', () => {
    const chart = allText(svc.toSlackBlocks(brief, report(), APP_URL)).find(
      (t) => t.startsWith('*Work mix*'),
    );
    const [features, upkeep] = chart!.split('\n').slice(2, 4);
    expect(features.indexOf('█')).toBe(upkeep.indexOf('█'));
    // 1 commit against a 21-commit max rounds to zero bars; an empty row would
    // read as "none", so a non-zero category always keeps one block.
    expect(upkeep).toContain('█');
  });

  it('draws a sparkline over the period and names the busiest day', () => {
    const spark = allText(svc.toSlackBlocks(brief, report(), APP_URL)).find(
      (t) => t.includes('busiest'),
    );
    expect(spark).toContain('`▄▁█`');
    expect(spark).toContain('May 19 → May 21');
    expect(spark).toContain('busiest May 21, 9 commits');
  });

  it('escapes Slack’s three reserved characters in brief-supplied text', () => {
    const text = allText(
      svc.toSlackBlocks(
        { ...brief, summary: 'Fixed <Modal> in A&B' },
        report(),
        APP_URL,
      ),
    ).join('\n');
    expect(text).toContain('Fixed &lt;Modal&gt; in A&amp;B');
  });

  it('stays inside every Block Kit limit on a long brief', () => {
    const blocks = svc.toSlackBlocks(
      {
        ...brief,
        title: 'x'.repeat(400),
        summary: 'y'.repeat(9000),
        highlights: Array.from({ length: 40 }, (_, i) => ({
          title: `h${i}`,
          detail: 'z'.repeat(200),
        })),
      },
      report(),
      APP_URL,
    );
    expect(blocks.length).toBeLessThanOrEqual(50);
    const header = blocks[0] as { text: { text: string } };
    expect(header.text.text.length).toBeLessThanOrEqual(150);
    for (const text of allText(blocks)) {
      expect(text.length).toBeLessThanOrEqual(3000);
    }
  });

  it('degrades to the narrative when the report is unavailable', () => {
    const blocks = svc.toSlackBlocks(brief, null, APP_URL);
    const text = allText(blocks).join('\n');
    expect(text).toContain(brief.summary);
    expect(text).toContain('• *Push notifications are live*');
    expect(text).not.toContain('*Work mix*');
    expect(blocks[blocks.length - 1]).toMatchObject({ type: 'actions' });
  });

  it('drops the charts when the scope was deleted after generation', () => {
    const text = allText(
      svc.toSlackBlocks(brief, report({ scopeDeleted: true }), APP_URL),
    ).join('\n');
    expect(text).not.toContain('*Commits*');
    expect(text).not.toContain('*Work mix*');
  });

  it('omits the lines field when no commit has been analysed for LOC', () => {
    const text = allText(
      svc.toSlackBlocks(
        brief,
        report({
          totals: { ...report().totals, linesAdded: 0, linesRemoved: 0 },
          locCoverage: { withLoc: 0, total: 24 },
        }),
        APP_URL,
      ),
    ).join('\n');
    expect(text).toContain('*Commits*');
    expect(text).not.toContain('*Lines*');
  });
});
