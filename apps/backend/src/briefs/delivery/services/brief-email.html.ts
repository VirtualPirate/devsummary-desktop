import {
  WORK_CATEGORIES,
  WORK_CATEGORY_LABEL,
  type BriefHighlight,
  type BriefReportDay,
  type BriefReportResponse,
  type WorkCategory,
} from '@launchstack/api-interfaces';
import type { RenderableBrief } from './brief-render.service';

/**
 * The brief report as an email. Everything here is a table with inline styles
 * and hex colours: Gmail strips `<style>`, Outlook ignores flexbox, and no
 * client resolves the `oklch()` design tokens the web report is built from —
 * so the palette below is those tokens converted once, not a second theme.
 */

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const COLOR = {
  page: '#f8fafd',
  card: '#ffffff',
  ink: '#141b24',
  muted: '#535961',
  border: '#dee2e5',
  track: '#f0f2f4',
  brand: '#1a73d5',
  up: '#33903c',
  down: '#bd7d00',
};

/** `WORK_CATEGORY_CSS_VAR` from the web report, resolved to light-mode hex. */
const CATEGORY_COLOR: Record<WorkCategory, string> = {
  feature: '#1a73d5',
  fix: '#33903c',
  optimization: '#8b4ec4',
  refactor: '#bd7d00',
  upkeep: '#6a727d',
};
const UNCLASSIFIED_COLOR = '#a3aab3';

const CHART_HEIGHT = 116;
/** Beyond a month of columns the bars are thinner than their own gap. */
const MAX_CHART_DAYS = 40;
const MAX_HIGHLIGHTS = 8;
const MAX_CONTRIBUTORS = 6;
const MAX_REPOSITORIES = 8;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function count(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * A `YYYY-MM-DD` bucket key is already resolved in the report's zone, so it is
 * anchored at UTC midnight and formatted in UTC. Routing it through any other
 * zone shifts it a day.
 */
function formatDayKey(
  key: string,
  opts: Intl.DateTimeFormatOptions = {},
): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    ...opts,
  });
}

/** `0.31` reads as `+31%`; null means no comparable prior period. */
function ratioNote(r: number | null): Note | null {
  if (r === null || !Number.isFinite(r)) return null;
  const pct = Math.round(r * 100);
  if (pct === 0) return { text: '±0%', color: COLOR.muted };
  return {
    text: `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`,
    color: pct > 0 ? COLOR.up : COLOR.down,
  };
}

function diffNote(d: number | null): Note | null {
  if (d === null) return null;
  if (d === 0) return { text: '±0', color: COLOR.muted };
  return {
    text: `${d > 0 ? '+' : '−'}${Math.abs(d)}`,
    color: d > 0 ? COLOR.up : COLOR.down,
  };
}

interface Note {
  text: string;
  color: string;
}

interface Kpi {
  label: string;
  value: string;
  note: Note | null;
  /** Off for a value that is a word, not a figure — mono spaces dates badly. */
  text?: boolean;
}

function dayTotal(d: BriefReportDay): number {
  return Object.values(d.counts).reduce((n, v) => n + v, 0);
}

/**
 * Hidden first line. Every inbox shows it beside the subject, and without one
 * it shows whatever markup leaks first instead.
 */
function preheader(summary: string): string {
  const text = summary.replace(/\s+/g, ' ').trim().slice(0, 140);
  return `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">${escapeHtml(
    text,
  )}</div>`;
}

function heading(title: string, caption?: string): string {
  return [
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>',
    `<td style="font-family:${FONT};font-size:15px;font-weight:600;color:${COLOR.ink};">${escapeHtml(title)}</td>`,
    caption
      ? `<td align="right" style="font-family:${FONT};font-size:12.5px;color:${COLOR.muted};">${escapeHtml(caption)}</td>`
      : '',
    '</tr></table>',
  ].join('');
}

/** One block, separated from the previous by a hairline — the web report's rhythm. */
function block(inner: string): string {
  return `<tr><td style="padding:24px 28px;border-top:1px solid ${COLOR.border};">${inner}</td></tr>`;
}

/** A horizontal bar sized against the largest row, not against the total. */
function bar(
  label: string,
  valueLabel: string,
  value: number,
  max: number,
  color: string,
): string {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return [
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;"><tr>',
    `<td style="font-family:${FONT};font-size:13px;color:${COLOR.ink};">${escapeHtml(label)}</td>`,
    `<td align="right" style="font-family:${MONO};font-size:11.5px;color:${COLOR.muted};white-space:nowrap;padding-left:10px;">${escapeHtml(valueLabel)}</td>`,
    '</tr><tr><td colspan="2" style="padding-top:5px;">',
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLOR.track};border-radius:4px;"><tr>`,
    `<td width="${pct}%" style="background:${color};border-radius:4px;font-size:0;line-height:7px;height:7px;">&nbsp;</td>`,
    pct < 100
      ? `<td width="${100 - pct}%" style="font-size:0;line-height:7px;height:7px;">&nbsp;</td>`
      : '',
    '</tr></table></td></tr></table>',
  ].join('');
}

function kpiCell(kpi: Kpi): string {
  return [
    `<td width="33%" valign="top" style="padding:12px 14px;background:${COLOR.page};border:1px solid ${COLOR.border};border-radius:12px;">`,
    `<div style="font-family:${FONT};font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${COLOR.muted};">${escapeHtml(kpi.label)}</div>`,
    `<div style="font-family:${kpi.text ? FONT : MONO};font-size:${kpi.text ? 17 : 20}px;font-weight:600;color:${COLOR.ink};padding-top:4px;">${escapeHtml(kpi.value)}</div>`,
    kpi.note
      ? `<div style="font-family:${MONO};font-size:11px;color:${kpi.note.color};padding-top:2px;">${escapeHtml(kpi.note.text)}</div>`
      : '',
    '</td>',
  ].join('');
}

/** Three across, rows of three, 10px gutters faked with spacer cells. */
function kpiGrid(report: BriefReportResponse): string {
  const t = report.totals;
  const d = report.deltas;
  const kpis: Kpi[] = [
    { label: 'Commits', value: count(t.commits), note: ratioNote(d.commits) },
    {
      label: 'People',
      value: count(t.contributors),
      note: diffNote(d.contributors),
    },
    {
      label: 'Repositories',
      value: count(t.repositoriesTouched),
      note: { text: `of ${count(t.repositoriesInScope)}`, color: COLOR.muted },
    },
  ];
  // Line counts come off commit analyses, so a period whose commits are all
  // still unanalysed has no figure to show rather than a real zero.
  if (t.linesAdded + t.linesRemoved > 0) {
    kpis.push(
      {
        label: 'Lines added',
        value: `+${count(t.linesAdded)}`,
        note: ratioNote(d.linesAdded),
      },
      {
        label: 'Lines removed',
        value: `−${count(t.linesRemoved)}`,
        note: ratioNote(d.linesRemoved),
      },
    );
  }
  if (t.busiestDay) {
    kpis.push({
      label: 'Busiest day',
      value: formatDayKey(t.busiestDay.date, { weekday: 'short' }),
      text: true,
      note: {
        text: `${count(t.busiestDay.commits)} commits`,
        color: COLOR.muted,
      },
    });
  }

  const rows: string[] = [];
  for (let i = 0; i < kpis.length; i += 3) {
    const cells = kpis.slice(i, i + 3).map(kpiCell);
    while (cells.length < 3) cells.push('<td width="33%">&nbsp;</td>');
    rows.push(
      `<tr>${cells.join('<td width="10" style="font-size:0;">&nbsp;</td>')}</tr>`,
      '<tr><td colspan="5" height="10" style="font-size:0;line-height:10px;">&nbsp;</td></tr>',
    );
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;">${rows
    .slice(0, -1)
    .join('')}</table>`;
}

function summaryHtml(summary: string): string {
  return summary
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean)
    .map(
      (para) =>
        `<p style="font-family:${FONT};font-size:15.5px;line-height:1.65;color:${COLOR.ink};margin:0 0 14px 0;">${escapeHtml(
          para,
        ).replace(/\n/g, '<br />')}</p>`,
    )
    .join('');
}

function highlightsHtml(highlights: BriefHighlight[], commits: number): string {
  const shown = highlights.slice(0, MAX_HIGHLIGHTS);
  const hidden = highlights.length - shown.length;
  const rows = shown
    .map((h, i) => {
      const top = i === 0 ? '' : `border-top:1px solid ${COLOR.border};`;
      return [
        '<tr>',
        `<td width="34" valign="top" style="${top}padding:11px 0 11px 14px;font-family:${MONO};font-size:11px;color:${COLOR.muted};">${String(
          i + 1,
        ).padStart(2, '0')}</td>`,
        `<td valign="top" style="${top}padding:11px 14px 11px 6px;">`,
        `<div style="font-family:${FONT};font-size:14.5px;color:${COLOR.ink};">${escapeHtml(h.title)}</div>`,
        `<div style="font-family:${FONT};font-size:12.5px;line-height:1.5;color:${COLOR.muted};padding-top:3px;">${escapeHtml(h.detail)}</div>`,
        '</td></tr>',
      ].join('');
    })
    .join('');
  return [
    heading(
      'Highlights',
      commits > 0 ? `${highlights.length} from ${count(commits)} commits` : '',
    ),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;border:1px solid ${COLOR.border};border-radius:12px;border-collapse:separate;">${rows}</table>`,
    hidden > 0
      ? `<p style="font-family:${FONT};font-size:12.5px;color:${COLOR.muted};margin:10px 0 0 0;">+${hidden} more in the full report</p>`
      : '',
  ].join('');
}

/**
 * Stacked columns, one per day, in the same fixed category order as the web
 * report. Segment heights are pixels rather than percentages: percentage
 * heights collapse in Outlook, and a column of `<td>`s is the one stacking
 * primitive every client agrees on.
 */
function activityHtml(daily: BriefReportDay[]): string {
  const max = daily.reduce((n, d) => Math.max(n, dayTotal(d)), 0);
  if (max === 0) return '';

  const labelEvery = Math.ceil(daily.length / 12);
  const columns = daily
    .map((d, i) => {
      const segments = [
        ...WORK_CATEGORIES.filter((c) => d.counts[c] > 0).map((c) => ({
          value: d.counts[c],
          color: CATEGORY_COLOR[c],
        })),
        ...(d.counts.unclassified > 0
          ? [{ value: d.counts.unclassified, color: UNCLASSIFIED_COLOR }]
          : []),
      ]
        // Bottom-up, so the first category sits on the baseline as on the web.
        .reverse()
        .map(
          (s) =>
            `<tr><td style="background:${s.color};font-size:0;line-height:0;height:${Math.max(
              2,
              Math.round((s.value / max) * CHART_HEIGHT),
            )}px;">&nbsp;</td></tr>`,
        )
        .join('');
      // A day with nothing shipped still gets a stub, so the gap is legible as
      // a quiet day rather than as a missing column.
      const body =
        segments ||
        `<tr><td style="background:${COLOR.border};font-size:0;line-height:0;height:2px;">&nbsp;</td></tr>`;
      const label =
        daily.length <= 16 || i % labelEvery === 0
          ? Number(d.date.slice(8))
          : '';
      return {
        column: `<td valign="bottom" style="padding:0 2px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${body}</table></td>`,
        label: `<td align="center" style="font-family:${MONO};font-size:10px;color:${COLOR.muted};padding-top:6px;">${label}</td>`,
      };
    })
    .reduce<{ columns: string[]; labels: string[] }>(
      (acc, c) => {
        acc.columns.push(c.column);
        acc.labels.push(c.label);
        return acc;
      },
      { columns: [], labels: [] },
    );

  const legend = [
    ...WORK_CATEGORIES.filter((c) => daily.some((d) => d.counts[c] > 0)).map(
      (c) => ({ color: CATEGORY_COLOR[c], label: WORK_CATEGORY_LABEL[c][1] }),
    ),
    // Its grey is a shade off upkeep's, so an unnamed segment reads as upkeep.
    ...(daily.some((d) => d.counts.unclassified > 0)
      ? [{ color: UNCLASSIFIED_COLOR, label: 'not yet analysed' }]
      : []),
  ]
    .map(
      (item) =>
        `<td width="10" style="font-size:0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="9" style="background:${item.color};border-radius:2px;font-size:0;line-height:9px;height:9px;">&nbsp;</td></tr></table></td>` +
        `<td style="font-family:${FONT};font-size:11.5px;color:${COLOR.muted};padding:0 14px 0 5px;white-space:nowrap;">${escapeHtml(
          item.label,
        )}</td>`,
    )
    .join('');

  return [
    heading('Activity', 'commits per day'),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;margin-top:14px;height:${CHART_HEIGHT}px;">`,
    `<tr>${columns.columns.join('')}</tr>`,
    `</table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;border-top:1px solid ${COLOR.border};">`,
    `<tr>${columns.labels.join('')}</tr></table>`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;"><tr>${legend}</tr></table>`,
  ].join('');
}

function workMixHtml(report: BriefReportResponse): string {
  const max = report.workBreakdown[0]?.commits ?? 0;
  const total = report.totals.commits || 1;
  return [
    heading('What the work was'),
    report.workBreakdown
      .map((w) =>
        bar(
          WORK_CATEGORY_LABEL[w.category][1],
          `${count(w.commits)} · ${Math.round((w.commits / total) * 100)}%`,
          w.commits,
          max,
          CATEGORY_COLOR[w.category],
        ),
      )
      .join(''),
  ].join('');
}

function contributorsHtml(report: BriefReportResponse): string {
  const rows = report.contributors.slice(0, MAX_CONTRIBUTORS);
  const max = rows[0]?.commits ?? 0;
  return [
    heading(
      'Who shipped it',
      report.contributors.length > rows.length
        ? `top ${rows.length} of ${report.contributors.length}`
        : '',
    ),
    rows
      .map((c) =>
        bar(
          c.isBot ? `${c.name} (bot)` : c.name,
          `${count(c.commits)} · ${c.repositories} ${c.repositories === 1 ? 'repo' : 'repos'}`,
          c.commits,
          max,
          c.isBot ? CATEGORY_COLOR.upkeep : CATEGORY_COLOR.feature,
        ),
      )
      .join(''),
  ].join('');
}

function repositoriesHtml(report: BriefReportResponse): string {
  const rows = report.repositories.slice(0, MAX_REPOSITORIES);
  const max = rows[0]?.commits ?? 0;
  return [
    heading(
      'Where it happened',
      `${count(report.totals.repositoriesTouched)} of ${count(
        report.totals.repositoriesInScope,
      )} repositories`,
    ),
    rows
      .map((r) =>
        bar(
          r.fullName,
          `${count(r.commits)} · +${count(r.linesAdded)} / −${count(r.linesRemoved)}`,
          r.commits,
          max,
          CATEGORY_COLOR.feature,
        ),
      )
      .join(''),
  ].join('');
}

/**
 * `report` is nullable because the figures are a nicety and the brief is not:
 * without one this degrades to the title, summary and highlights rather than
 * failing the delivery.
 */
export function renderBriefEmailHtml(
  brief: RenderableBrief,
  report: BriefReportResponse | null,
  appUrl: string,
): string {
  // `scopeDeleted` zeroes every figure, so its charts would all be empty.
  const stats =
    report && !report.scopeDeleted && report.totals.commits > 0 ? report : null;
  const url = `${appUrl.replace(/\/+$/, '')}/briefs/${brief.id}`;

  const blocks: string[] = [];
  if (stats) blocks.push(kpiGrid(stats));
  if (brief.summary.trim()) blocks.push(summaryHtml(brief.summary));
  if (brief.highlights.length > 0) {
    blocks.push(highlightsHtml(brief.highlights, stats?.totals.commits ?? 0));
  }
  if (stats && stats.daily.length > 1 && stats.daily.length <= MAX_CHART_DAYS) {
    blocks.push(activityHtml(stats.daily));
  }
  if (stats && stats.workBreakdown.length > 0) blocks.push(workMixHtml(stats));
  if (stats && stats.contributors.length > 0) {
    blocks.push(contributorsHtml(stats));
  }
  if (stats && stats.repositories.length > 0) {
    blocks.push(repositoriesHtml(stats));
  }

  return [
    '<!DOCTYPE html>',
    '<html lang="en"><head><meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<meta name="color-scheme" content="light" />',
    `<title>${escapeHtml(brief.title || 'Engineering brief')}</title></head>`,
    `<body style="margin:0;padding:0;background:${COLOR.page};-webkit-font-smoothing:antialiased;">`,
    preheader(brief.summary || brief.briefInfoTitle),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLOR.page};">`,
    '<tr><td align="center" style="padding:24px 12px;">',
    `<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;background:${COLOR.card};border:1px solid ${COLOR.border};border-radius:16px;">`,

    // Masthead: brand, the period/counts line, then the title.
    '<tr><td style="padding:28px 28px 24px 28px;">',
    `<div style="font-family:${FONT};font-size:13px;font-weight:600;color:${COLOR.brand};letter-spacing:0.02em;">DevSummary</div>`,
    `<div style="font-family:${FONT};font-size:12.5px;color:${COLOR.muted};padding-top:14px;">${escapeHtml(brief.briefInfoTitle)}</div>`,
    `<h1 style="font-family:${FONT};font-size:26px;line-height:1.25;font-weight:700;color:${COLOR.ink};margin:6px 0 0 0;">${escapeHtml(
      brief.title || 'Engineering brief',
    )}</h1>`,
    '</td></tr>',

    ...blocks.map(block),

    `<tr><td align="center" style="padding:26px 28px 30px 28px;border-top:1px solid ${COLOR.border};">`,
    `<a href="${escapeHtml(url)}" style="display:inline-block;background:${COLOR.brand};color:#ffffff;font-family:${FONT};font-size:14px;font-weight:600;text-decoration:none;padding:12px 22px;border-radius:8px;">Open the full report</a>`,
    '</td></tr></table>',

    `<div style="font-family:${FONT};font-size:11.5px;color:${COLOR.muted};padding:16px 8px 0 8px;max-width:640px;">You are receiving this because your team scheduled this brief in DevSummary.</div>`,
    '</td></tr></table></body></html>',
  ].join('');
}
