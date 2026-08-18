export function betterAuth(_config: any) {
  return {
    handler: async (_req: any) => new Response('ok'),
    api: {},
    // A real pg Pool is passed as `database`; swap it for a stable marker so
    // tests snapshotting the options never serialize pool internals.
    options: _config?.database
      ? { ..._config, database: { id: 'pg-pool' } }
      : _config,
  };
}
