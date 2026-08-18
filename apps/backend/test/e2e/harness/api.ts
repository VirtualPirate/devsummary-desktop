import type { Server } from 'node:http';
import request from 'supertest';

/**
 * The per-boot loopback token. `setup-file.ts` puts this in `API_TOKEN` before
 * any module loads, and `LocalTokenGuard` reads that env var when DI builds it.
 */
export const E2E_API_TOKEN = 'e2e-desktop-token';

type Method = 'get' | 'post' | 'patch' | 'delete';

/**
 * supertest with the two headers the desktop client always sends.
 *
 * `x-desktop-token` is mandatory on everything except `/api/health*`; the
 * workspace header is optional — `OrgContextGuard` falls back to
 * `LOCAL_ORG_ID` when it is absent — so pass `organizationId` only when the
 * test is about a workspace other than the seeded default.
 *
 * Use plain `request(server)` when the point of the test is a *missing* token.
 */
export function api(server: Server, organizationId?: string) {
  const call = (method: Method, path: string) => {
    const test = request(server)
      [method](path)
      .set('x-desktop-token', E2E_API_TOKEN);
    return organizationId
      ? test.set('x-organization-id', organizationId)
      : test;
  };

  return {
    get: (path: string) => call('get', path),
    post: (path: string) => call('post', path),
    patch: (path: string) => call('patch', path),
    delete: (path: string) => call('delete', path),
  };
}
