import { once } from './activity-proxies';

export async function NoopWorkflow(message: string): Promise<void> {
  await once['noop.run'](message);
}
