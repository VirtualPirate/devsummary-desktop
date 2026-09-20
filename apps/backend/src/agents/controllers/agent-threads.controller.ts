import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import type { ApiResponse } from '@launchstack/api-interfaces';
import { AppError } from '../../common/errors';
import {
  OrgMembership,
  type OrgMembershipContext,
} from '../../organizations/decorators/org-membership.decorator';
import { RequireOrgRole } from '../../organizations/decorators/require-org-role.decorator';
import { ZodValidationPipe } from '../../organizations/dto/zod-validation.pipe';
import type { AgentSessionSelect } from '../../databases/kysely';
import { fromWireMessages } from '../agent-wire';
import { AgentSessionsRepository } from '../repositories/agent-sessions.repository';
import {
  AgentGraphService,
  type RunTokens,
} from '../services/agent-graph.service';
import { AgentUsageService } from '../services/agent-usage.service';

const ThreadIdParamSchema = z.object({ threadId: z.uuid() });
type ThreadIdParam = z.infer<typeof ThreadIdParamSchema>;

const RenameThreadSchema = z.object({ title: z.string().min(1).max(200) });
type RenameThreadRequest = z.infer<typeof RenameThreadSchema>;

const RunSchema = z.object({
  messages: z
    .array(
      z.object({
        id: z.string().optional(),
        type: z.string().optional(),
        content: z.unknown().optional(),
        tool_call_id: z.string().optional(),
        name: z.string().optional(),
      }),
    )
    .max(100),
});
type RunRequest = z.infer<typeof RunSchema>;

export interface AgentThread {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

/** How much of the first prompt becomes the thread's name in the rail. */
const TITLE_MAX = 60;

function toThread(row: AgentSessionSelect): AgentThread {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The agent's whole HTTP surface. The row id *is* the LangGraph thread id, so
 * there is no upstream id to reconcile and no path segment to allow-list: a
 * thread that is not this workspace's is a 404 here, before the graph is built,
 * and the graph's tools can only ever read the workspace the guard resolved.
 *
 * Like every other route outside `/api/health*`, all of these also require the
 * per-boot `x-desktop-token` — `LocalTokenGuard` is a root-module `APP_GUARD`,
 * so the SSE endpoint is covered without saying so here.
 */
@Controller('api/agents/threads')
export class AgentThreadsController {
  constructor(
    private readonly sessions: AgentSessionsRepository,
    private readonly graph: AgentGraphService,
    private readonly usage: AgentUsageService,
  ) {}

  @Get()
  @RequireOrgRole('member')
  async list(
    @OrgMembership() m: OrgMembershipContext,
  ): Promise<ApiResponse<AgentThread[]>> {
    const rows = await this.sessions.listByOrganization(m.organizationId);
    return { data: rows.map(toThread), message: 'OK', success: true };
  }

  @Post()
  @RequireOrgRole('member')
  async create(
    @OrgMembership() m: OrgMembershipContext,
  ): Promise<ApiResponse<AgentThread>> {
    const row = await this.sessions.create({
      organizationId: m.organizationId,
      createdBy: m.userId,
      title: null,
    });
    return { data: toThread(row), message: 'Created', success: true };
  }

  @Patch(':threadId')
  @RequireOrgRole('member')
  async rename(
    @OrgMembership() m: OrgMembershipContext,
    @Param(new ZodValidationPipe(ThreadIdParamSchema)) params: ThreadIdParam,
    @Body(new ZodValidationPipe(RenameThreadSchema)) body: RenameThreadRequest,
  ): Promise<ApiResponse<AgentThread>> {
    const row = await this.sessions.rename(
      params.threadId,
      m.organizationId,
      body.title,
    );
    if (!row) throw AppError.AGENT_SESSION_NOT_FOUND();
    return { data: toThread(row), message: 'Renamed', success: true };
  }

  @Delete(':threadId')
  @RequireOrgRole('member')
  async remove(
    @OrgMembership() m: OrgMembershipContext,
    @Param(new ZodValidationPipe(ThreadIdParamSchema)) params: ThreadIdParam,
  ): Promise<ApiResponse<null>> {
    await this.sessions.softDelete(params.threadId, m.organizationId);
    return { data: null, message: 'Deleted', success: true };
  }

  @Get(':threadId/messages')
  @RequireOrgRole('member')
  async messages(
    @OrgMembership() m: OrgMembershipContext,
    @Param(new ZodValidationPipe(ThreadIdParamSchema)) params: ThreadIdParam,
  ): Promise<ApiResponse<unknown[]>> {
    await this.owned(params.threadId, m.organizationId);
    return {
      data: await this.graph.history(m.organizationId, params.threadId),
      message: 'OK',
      success: true,
    };
  }

  /**
   * `@Res()` rather than `@Sse()`: `@Sse` frames whatever you hand it, and these
   * frames are already SSE. Piping through it produced the literal text
   * `data: data: {...}` and the client parsed none of it.
   */
  @Post(':threadId/stream')
  @RequireOrgRole('member')
  async stream(
    @OrgMembership() m: OrgMembershipContext,
    @Param(new ZodValidationPipe(ThreadIdParamSchema)) params: ThreadIdParam,
    @Body(new ZodValidationPipe(RunSchema)) body: RunRequest,
    @Req() req: { on: (event: string, cb: () => void) => void },
    @Res() res: Response,
  ): Promise<void> {
    const row = await this.owned(params.threadId, m.organizationId);

    // The cloud original also refused a deactivated tenant here, since this is
    // the one route in the module that spends money. There is no such state on
    // a single-user install — a workspace is either there or deleted.
    const messages = fromWireMessages(body.messages);

    // Written before the model runs, so a stream that dies halfway still leaves
    // a record of the run. See `AgentUsageService`.
    const usageId = await this.usage.reserve({
      organizationId: m.organizationId,
      sessionId: row.id,
      userId: m.userId,
    });

    const controller = new AbortController();
    req.on('close', () => controller.abort());

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Without this a reverse proxy will sit on the stream until it closes.
      'x-accel-buffering': 'no',
    });
    res.flushHeaders();

    const tokens: RunTokens = { promptTokens: null, completionTokens: null };
    try {
      for await (const event of this.graph.run({
        organizationId: m.organizationId,
        threadId: row.id,
        messages,
        signal: controller.signal,
        tokens,
      })) {
        res.write(
          `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`,
        );
      }
    } catch (error) {
      // The status is already sent, so the only way to report this is in-band.
      // Swallowing it left a composer that had spun forever with no message.
      if (!controller.signal.aborted) {
        res.write(
          `event: error\ndata: ${JSON.stringify({
            message:
              error instanceof Error ? error.message : 'Agent run failed',
          })}\n\n`,
        );
      }
    } finally {
      controller.abort();
      res.end();
      await this.usage.settle(usageId, tokens);
      await this.titleFrom(row, messages);
    }
  }

  private async owned(
    threadId: string,
    organizationId: string,
  ): Promise<AgentSessionSelect> {
    const row = await this.sessions.findByIdScopedToOrg(
      threadId,
      organizationId,
    );
    if (!row) throw AppError.AGENT_SESSION_NOT_FOUND();
    return row;
  }

  /**
   * Names the thread after its first prompt. The runtime this replaced spent a
   * second model call on a summary; the first line of what the user asked is
   * both cheaper and a better label than "New thread" on every row.
   */
  private async titleFrom(
    row: AgentSessionSelect,
    messages: { getType: () => string; text: string }[],
  ): Promise<void> {
    if (row.title) {
      await this.sessions.touch(row.id);
      return;
    }
    const first = messages.find((message) => message.getType() === 'human');
    const title = first?.text.trim().replace(/\s+/g, ' ').slice(0, TITLE_MAX);
    if (!title) {
      await this.sessions.touch(row.id);
      return;
    }
    await this.sessions.rename(row.id, row.organizationId, title);
  }
}
