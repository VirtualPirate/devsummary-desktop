import { Injectable, Logger } from '@nestjs/common';
import type { SlackChannel } from '@launchstack/api-interfaces';
import { AppError } from '../../../common/errors';
import { SlackInstallationsRepository } from '../repositories/installations.repository';
import { SlackClient, type SlackBlock } from '../slack.client';

@Injectable()
export class SlackMessagesService {
  private readonly logger = new Logger(SlackMessagesService.name);

  constructor(
    private readonly installs: SlackInstallationsRepository,
    private readonly client: SlackClient,
  ) {}

  private async requireInstallation(orgId: string) {
    const row = await this.installs.findActiveByOrganizationId(orgId);
    if (!row) {
      throw AppError.SLACK_INSTALLATION_NOT_FOUND();
    }
    return row;
  }

  /**
   * `text` is still required alongside `blocks`: Slack falls back to it for
   * notifications and screen readers, where blocks are not rendered at all.
   */
  async postMessage(
    orgId: string,
    channelId: string,
    text: string,
    blocks?: SlackBlock[],
  ): Promise<{ success: true; ts: string }> {
    const installation = await this.requireInstallation(orgId);
    const res = await this.client.postMessage(
      installation.accessToken,
      channelId,
      text,
      blocks,
    );
    this.logger.log(
      `Slack message posted org=${orgId} team=${installation.raw.teamId} channel=${channelId}`,
    );
    return { success: true, ts: String(res.ts ?? '') };
  }

  /**
   * Archived conversations are dropped: they list fine and then reject every
   * post, so offering one is offering a schedule that can only fail.
   */
  async listChannels(orgId: string): Promise<SlackChannel[]> {
    const installation = await this.requireInstallation(orgId);
    const channels = await this.client.getChannels(installation.accessToken);
    return channels
      .filter((channel) => channel.id && !channel.is_archived)
      .map((channel) => ({
        id: channel.id as string,
        name: channel.name ?? channel.id ?? '',
        isPrivate: channel.is_private === true,
        isMember: channel.is_member === true,
        memberCount:
          typeof channel.num_members === 'number' ? channel.num_members : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Adds the bot to a public channel so delivery stops failing with
   * `not_in_channel`. A private channel is refused rather than attempted: no
   * token can join one, only a member's `/invite` can.
   */
  async joinChannel(orgId: string, channelId: string): Promise<void> {
    const installation = await this.requireInstallation(orgId);
    const channel = (await this.listChannels(orgId)).find(
      (item) => item.id === channelId,
    );
    if (channel?.isPrivate) {
      throw AppError.SLACK_API_FAILED({
        reason: `#${channel.name} is private — invite @DevSummary from inside Slack instead`,
      });
    }
    await this.client.joinChannel(installation.accessToken, channelId);
    this.logger.log(`Slack channel joined org=${orgId} channel=${channelId}`);
  }

  async listMembers(orgId: string) {
    const installation = await this.requireInstallation(orgId);
    return this.client.getMembers(installation.accessToken);
  }
}
