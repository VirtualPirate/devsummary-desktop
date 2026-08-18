/**
 * @jest-environment <rootDir>/../test/timezone-jest-environment.js
 * @jest-environment-options {"timezone": "Pacific/Chatham"}
 *
 * Chatham is +12:45, so a day key routed through the process zone instead of
 * being anchored in UTC prints the wrong date — the one failure a UTC-only run
 * can never show.
 */
import { renderBriefEmailHtml } from '../services/brief-email.html';
import { APP_URL, brief, day, report } from './report.fixture';

const html = () => renderBriefEmailHtml(brief, report(), APP_URL);

describe('renderBriefEmailHtml', () => {
  it('carries the title, period line, summary and highlights', () => {
    const out = html();
    expect(out).toContain('Mobile shipped notifications');
    expect(out).toContain(brief.briefInfoTitle);
    expect(out).toContain(brief.summary);
    expect(out).toContain('Push notifications are live');
    expect(out).toContain('Users get order updates.');
  });

  it('links the full report, tolerating a trailing slash on the app URL', () => {
    expect(renderBriefEmailHtml(brief, report(), `${APP_URL}/`)).toContain(
      `href="${APP_URL}/briefs/b1"`,
    );
  });

  it('prints every KPI with its delta', () => {
    const out = html();
    expect(out).toContain('>24<'); // commits
    expect(out).toContain('+31%');
    expect(out).toContain('+2'); // contributors, absolute
    expect(out).toContain('of 5'); // repositories in scope
    expect(out).toContain('+12,431');
    expect(out).toContain('−3,880');
  });

  it('names the busiest day in the report zone, not the server zone', () => {
    // 2026-05-21 must not print as May 20 or May 22 under +12:45.
    expect(html()).toContain('Thu, May 21');
    expect(html()).not.toContain('May 22');
  });

  it('scales the activity columns against the busiest day', () => {
    const out = html();
    expect(out).toContain('height:116px'); // 9 commits = the full chart height
    expect(out).toContain('height:52px'); // 4 commits
    expect(out).toContain('height:2px'); // the quiet day keeps a stub
  });

  it('drops the activity chart for a period too long to plot', () => {
    const daily = Array.from({ length: 60 }, (_, i) =>
      day(`2026-03-${String((i % 28) + 1).padStart(2, '0')}`, 1),
    );
    expect(
      renderBriefEmailHtml(brief, report({ daily }), APP_URL),
    ).not.toContain('commits per day');
  });

  it('sizes the work-mix bars against the largest row, never to nothing', () => {
    const out = html();
    expect(out).toContain('width="100%"'); // features, 21 of 21
    expect(out).toContain('width="5%"'); // upkeep, 1 of 21 — floored at 2%
    expect(out).toContain('88%'); // 21 of 24 commits
  });

  it('shows repository coverage and per-repo churn', () => {
    const out = html();
    expect(out).toContain('2 of 5 repositories');
    expect(out).toContain('acme/api');
    expect(out).toContain('+900 / −120');
  });

  it('escapes user text rather than emitting it as markup', () => {
    const out = renderBriefEmailHtml(
      { ...brief, summary: 'Fixed <script>alert(1)</script> & the checkout' },
      report(),
      APP_URL,
    );
    expect(out).toContain('&lt;script&gt;');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&amp; the checkout');
  });

  it('caps the highlight list and says how many are left', () => {
    const highlights = Array.from({ length: 12 }, (_, i) => ({
      title: `Highlight ${i + 1}`,
      detail: 'detail',
    }));
    const out = renderBriefEmailHtml(
      { ...brief, highlights },
      report(),
      APP_URL,
    );
    expect(out).toContain('Highlight 8');
    expect(out).not.toContain('Highlight 9<');
    expect(out).toContain('+4 more in the full report');
  });

  it('degrades to the narrative when the report could not be built', () => {
    const out = renderBriefEmailHtml(brief, null, APP_URL);
    expect(out).toContain(brief.summary);
    expect(out).toContain('Push notifications are live');
    expect(out).toContain('Open the full report');
    expect(out).not.toContain('commits per day');
    expect(out).not.toContain('Where it happened');
  });

  it('drops every figure for a deleted scope', () => {
    const out = renderBriefEmailHtml(
      brief,
      report({ scopeDeleted: true }),
      APP_URL,
    );
    expect(out).toContain(brief.summary);
    expect(out).not.toContain('Where it happened');
    expect(out).not.toContain('What the work was');
  });

  it('omits the line counts when no commit in the period is analysed yet', () => {
    const out = renderBriefEmailHtml(
      brief,
      report({
        totals: { ...report().totals, linesAdded: 0, linesRemoved: 0 },
        locCoverage: { withLoc: 0, total: 24 },
      }),
      APP_URL,
    );
    expect(out).not.toContain('Lines added');
  });
});
