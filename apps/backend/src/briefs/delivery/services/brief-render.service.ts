import { Injectable } from '@nestjs/common';
import type {
  BriefCadenceType,
  BriefHighlight,
  BriefScopeType,
  BriefReportResponse,
  WorkCategory,
} from '@launchstack/api-interfaces';
import type { SlackBlock } from '../../../integrations/slack/slack.client';

export interface RenderableBrief {
  id: string;
  title: string;
  briefInfoTitle: string;
  summary: string;
  highlights: BriefHighlight[];
  /**
   * What the brief covers, for the email subject line. Null when the scope was
   * deleted between generation and delivery — the subject then names the
   * cadence instead of a thing that no longer exists.
   */
  scope?: { type: BriefScopeType; name: string } | null;
  /** Null for an ad-hoc brief with no schedule behind it. */
  cadence?: BriefCadenceType | null;
}

/** `daily` names the day the period covered, not "today" — hence the past-tense read. */
const CADENCE_PERIOD: Record<BriefCadenceType, string> = {
  daily: "day's",
  weekly: "week's",
  monthly: "month's",
};

/**
 * Slack reserves exactly three characters; everything else in a message is
 * literal. A summary quoting `<script>` or an org named `A&B` otherwise reaches
 * the channel as a broken link or a stray entity.
 */
function escapeSlack(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Slack rejects a `header` past 150 characters and a `section` past 3000. */
const HEADER_MAX = 150;
const SECTION_MAX = 3000;

/** Repositories shown in the "where" chart. The button covers the rest. */
const TOP_REPOSITORIES = 5;

const BAR_WIDTH = 12;
const SPARK = '▁▂▃▄▅▆▇█';

/**
 * Shorter than `WORK_CATEGORY_LABEL`'s plurals on purpose: these are the left
 * column of a fixed-width chart, and "upkeep (docs, tests, chores)" pushes
 * every bar off a phone screen.
 */
const CATEGORY_LABEL: Record<WorkCategory, string> = {
  feature: 'features',
  fix: 'fixes',
  optimization: 'speed-ups',
  refactor: 'cleanups',
  upkeep: 'upkeep',
};

function truncate(s: string, max: number): string {
  const trimmed = s.trim();
  return trimmed.length <= max
    ? trimmed
    : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function count(n: number): string {
  return n.toLocaleString('en-US');
}

function section(text: string): SlackBlock {
  return {
    type: 'section',
    text: { type: 'mrkdwn', text: truncate(text, SECTION_MAX) },
  };
}

/**
 * Block Kit renders no charts, and a proportional font makes bars built from
 * block characters ragged — so every chart here is fenced, which is the one
 * way to get a monospace face in Slack and the only reason the columns line up.
 */
function barChart(rows: Array<{ label: string; value: number }>): string {
  const max = Math.max(...rows.map((r) => r.value));
  const labelWidth = Math.max(...rows.map((r) => r.label.length));
  const body = rows
    .map((r) => {
      // A non-zero row keeps at least one block: rounding it away renders as
      // "none", which is a different fact from "few".
      const scaled = max > 0 ? Math.round((r.value / max) * BAR_WIDTH) : 0;
      const filled = r.value > 0 ? Math.max(1, scaled) : 0;
      return `${r.label.padEnd(labelWidth)}  ${'█'.repeat(filled)}${'░'.repeat(
        BAR_WIDTH - filled,
      )}  ${count(r.value)}`;
    })
    .join('\n');
  return `\`\`\`\n${body}\n\`\`\``;
}

function sparkline(values: number[]): string {
  const max = Math.max(0, ...values);
  if (max === 0) return '';
  return values
    .map((v) => SPARK[Math.round((v / max) * (SPARK.length - 1))])
    .join('');
}

/** `0.31` reads as `↑31%`. Null means no comparable prior period — print nothing. */
function ratioDelta(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '';
  const pct = Math.round(Math.abs(value) * 100);
  if (pct === 0) return '';
  return value > 0 ? `  ↑${pct}%` : `  ↓${pct}%`;
}

function countDelta(value: number | null): string {
  if (value === null || value === 0) return '';
  return value > 0 ? `  ↑${value}` : `  ↓${Math.abs(value)}`;
}

/**
 * A `YYYY-MM-DD` bucket key is already resolved in the report's zone, so it is
 * anchored at UTC midnight and formatted in UTC. Sending it through any other
 * zone shifts it a day.
 */
function formatDayKey(key: string): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Highlights are ranked most important first and a section caps at 3000
 * characters, so the list is cut on a whole entry rather than mid-sentence —
 * the top of the ranking survives either way.
 */
function highlightList(highlights: BriefHighlight[]): string {
  const lines = ['*Highlights*'];
  let length = lines[0].length;
  for (const h of highlights) {
    const line = `• *${escapeSlack(h.title)}* — ${escapeSlack(h.detail)}`;
    if (length + line.length + 1 > SECTION_MAX) break;
    lines.push(line);
    length += line.length + 1;
  }
  return lines.join('\n');
}

@Injectable()
export class BriefRenderService {
  /**
   * The `text` alongside the blocks: Slack shows it in notifications and to
   * screen readers, where blocks are not rendered at all.
   */
  toSlackMarkdown(brief: RenderableBrief): string {
    return `*${escapeSlack(brief.title)}*\n_${escapeSlack(
      brief.briefInfoTitle,
    )}_\n\n${escapeSlack(brief.summary)}`;
  }

  /**
   * The whole report as Block Kit. `report` is nullable because the figures
   * are a nicety and the brief is not: without one this degrades to the title,
   * summary and highlights rather than failing the delivery.
   */
  toSlackBlocks(
    brief: RenderableBrief,
    report: BriefReportResponse | null,
    appUrl: string,
  ): SlackBlock[] {
    const blocks: SlackBlock[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: truncate(
            escapeSlack(brief.title) || 'Engineering brief',
            HEADER_MAX,
          ),
          emoji: true,
        },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: escapeSlack(brief.briefInfoTitle) }],
      },
    ];

    if (brief.summary.trim()) blocks.push(section(escapeSlack(brief.summary)));

    // `scopeDeleted` zeroes every figure, so its charts would all be empty.
    const stats =
      report && !report.scopeDeleted && report.totals.commits > 0
        ? report
        : null;

    if (stats) blocks.push(this.totalsBlock(stats));
    if (brief.highlights.length > 0) {
      blocks.push(section(highlightList(brief.highlights)));
    }
    if (stats) blocks.push(...this.chartBlocks(stats));

    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Open full report', emoji: true },
          url: `${appUrl.replace(/\/+$/, '')}/briefs/${brief.id}`,
          style: 'primary',
        },
      ],
    });

    return blocks;
  }

  /** Slack lays `fields` out two per row, so these read as a 2×2 KPI grid. */
  private totalsBlock(report: BriefReportResponse): SlackBlock {
    const t = report.totals;
    const fields = [
      `*Commits*\n${count(t.commits)}${ratioDelta(report.deltas.commits)}`,
      `*Contributors*\n${count(t.contributors)}${countDelta(
        report.deltas.contributors,
      )}`,
      `*Repositories*\n${count(t.repositoriesTouched)} of ${count(
        t.repositoriesInScope,
      )}`,
    ];
    // Line counts come off commit analyses; a period whose commits are all
    // still unanalysed has no figure to show rather than a real zero.
    if (t.linesAdded + t.linesRemoved > 0) {
      fields.push(
        `*Lines*\n+${count(t.linesAdded)} / −${count(t.linesRemoved)}`,
      );
    }
    return {
      type: 'section',
      fields: fields.map((text) => ({ type: 'mrkdwn', text })),
    };
  }

  private chartBlocks(report: BriefReportResponse): SlackBlock[] {
    const blocks: SlackBlock[] = [];

    if (report.workBreakdown.length > 0) {
      blocks.push(
        section(
          `*Work mix*\n${barChart(
            report.workBreakdown.map((w) => ({
              label: CATEGORY_LABEL[w.category],
              value: w.commits,
            })),
          )}`,
        ),
      );
    }

    const repositories = report.repositories.slice(0, TOP_REPOSITORIES);
    if (repositories.length > 0) {
      const hidden = report.repositories.length - repositories.length;
      blocks.push(
        section(
          `*Where it happened*${hidden > 0 ? `  _top ${repositories.length} of ${report.repositories.length}_` : ''}\n${barChart(
            repositories.map((r) => ({
              label: truncate(escapeSlack(r.fullName), 24),
              value: r.commits,
            })),
          )}`,
        ),
      );
    }

    // A single-day period has no shape to plot; the commit total above already
    // says everything the sparkline would.
    const spark =
      report.daily.length > 1
        ? sparkline(
            report.daily.map((d) =>
              Object.values(d.counts).reduce((a, b) => a + b, 0),
            ),
          )
        : '';
    if (spark) {
      const busiest = report.totals.busiestDay;
      const range = `${formatDayKey(report.daily[0].date)} → ${formatDayKey(
        report.daily[report.daily.length - 1].date,
      )}`;
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `\`${spark}\`  ${range}${
              busiest
                ? `  ·  busiest ${formatDayKey(busiest.date)}, ${count(
                    busiest.commits,
                  )} commits`
                : ''
            }`,
          },
        ],
      });
    }

    return blocks;
  }

  /**
   * The subject says what arrived, not what is in it. The AI title
   * ("Delivery Integrations, Data Integrity, and Marketing Updates") reads as
   * a newsletter and buries the one fact the recipient scans for.
   */
  emailSubject(brief: RenderableBrief): string {
    const scope = brief.scope;
    if (scope?.name) {
      switch (scope.type) {
        case 'collaborator':
          return `${scope.name}'s developer work report is ready`;
        case 'project':
          return `${scope.name} project's work report is ready`;
        case 'team':
          return `${scope.name} team's work report is ready`;
        case 'repository':
          return `${scope.name} repository's work report is ready`;
      }
    }
    const period = CADENCE_PERIOD[brief.cadence ?? 'weekly'];
    return `This ${period} development report is ready`;
  }
}
