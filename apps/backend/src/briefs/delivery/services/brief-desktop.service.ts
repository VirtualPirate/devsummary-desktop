import { Injectable, Logger } from '@nestjs/common';
import { LocalSettingsRepository } from '../../../local/settings/local-settings.repository';
import { parentPort } from '../../../local/settings/parent-port';
import type { RenderableBrief } from './brief-render.service';

const BODY_MAX = 240;

/**
 * The second delivery channel: a native notification on the machine the app is
 * running on. It is what makes a brief whose Slack post failed still visibly
 * land somewhere, and it is the only channel that needs no credential.
 */
@Injectable()
export class BriefDesktopService {
  private readonly logger = new Logger(BriefDesktopService.name);

  constructor(private readonly settings: LocalSettingsRepository) {}

  /** User setting, default on. Read by the deliverer before fanning out. */
  enabled(): Promise<boolean> {
    return this.settings.desktopNotificationsEnabled();
  }

  send(brief: RenderableBrief): Promise<void> {
    const port = parentPort();
    if (!port) {
      // Headless run: no Electron shell to notify. Throwing keeps the channel
      // honest — the deliverer records it as a failed channel rather than
      // counting a notification nobody saw towards "delivered".
      return Promise.reject(new Error('desktop channel unavailable'));
    }

    port.postMessage({
      type: 'notification',
      title: brief.title,
      body: truncate(brief.summary, BODY_MAX),
      briefId: brief.id,
    });
    this.logger.log(`Brief desktop notification posted brief=${brief.id}`);
    return Promise.resolve();
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
