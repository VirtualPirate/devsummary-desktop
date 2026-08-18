import type { INestApplicationContext } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { ACTIVITY_METADATA_KEY } from './temporal.tokens';

export function buildActivities(
  app: INestApplicationContext,
): Record<string, (...args: unknown[]) => Promise<unknown>> {
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const reflector = app.get(Reflector);
  const activities: Record<string, (...a: unknown[]) => Promise<unknown>> = {};

  for (const wrapper of discovery.getProviders()) {
    const instance = wrapper.instance as Record<string, unknown> | null;
    if (!instance || typeof instance !== 'object') continue;
    const proto = Object.getPrototypeOf(instance) as object;
    if (!proto) continue;
    for (const methodName of scanner.getAllMethodNames(proto)) {
      const method = instance[methodName];
      if (typeof method !== 'function') continue;
      const name = reflector.get<string | undefined>(
        ACTIVITY_METADATA_KEY,
        method as (...a: unknown[]) => unknown,
      );
      if (!name) continue;
      if (activities[name]) {
        throw new Error(`Duplicate activity name registered: ${name}`);
      }
      activities[name] = (...args: unknown[]) =>
        (method as (...a: unknown[]) => Promise<unknown>).apply(instance, args);
    }
  }
  return activities;
}
