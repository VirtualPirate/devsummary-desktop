import { Client, Connection } from '@temporalio/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFileDatabase } from '../harness/database';
import { createTestApp, type TestApp } from '../harness/create-test-app';

describe('temporal test server', () => {
  let connection: Connection;
  let client: Client;

  beforeAll(async () => {
    connection = await Connection.connect({
      address: process.env.TEMPORAL_ADDRESS,
    });
    client = new Client({ connection, namespace: 'default' });
  });

  afterAll(async () => {
    await connection.close();
  });

  it('is reachable at the injected address', async () => {
    expect(process.env.TEMPORAL_ADDRESS).toMatch(
      /^(127\.0\.0\.1|localhost):\d+$/,
    );
    const response = await client.workflowService.getSystemInfo({});
    expect(response.serverVersion).toBeTruthy();
  });

  it('has OrganizationId and Phase registered as search attributes', async () => {
    const response = await connection.operatorService.listSearchAttributes({
      namespace: 'default',
    });
    const names = Object.keys(response.customAttributes ?? {});
    expect(names).toContain('OrganizationId');
    expect(names).toContain('Phase');
  });
});

describe('SchedulesBootstrap', () => {
  let firstApp: TestApp;
  let secondApp: TestApp | undefined;
  let closeDb: () => Promise<void>;
  let scheduleConnection: Connection;
  let scheduleClient: Client;

  beforeAll(async () => {
    ({ close: closeDb } = await createFileDatabase());

    // Must be set before the first createTestApp() in this file. Vitest
    // isolates module registries per file, so this does not affect any other
    // spec. .env.test defaults this to false because re-running the bootstrap
    // on every app boot costs round trips for nothing.
    process.env.TEMPORAL_MANAGE_SCHEDULES = 'true';

    firstApp = await createTestApp();

    scheduleConnection = await Connection.connect({
      address: process.env.TEMPORAL_ADDRESS,
    });
    scheduleClient = new Client({
      connection: scheduleConnection,
      namespace: 'default',
    });
  });

  afterAll(async () => {
    await secondApp?.close();
    await firstApp?.close();
    await scheduleConnection?.close();
    await closeDb();
    process.env.TEMPORAL_MANAGE_SCHEDULES = 'false';
  });

  it('creates the briefs-dispatch-due schedule on boot', async () => {
    const handle = scheduleClient.schedule.getHandle('briefs-dispatch-due');
    const description = await handle.describe();
    expect(description.action.type).toBe('startWorkflow');
    expect(description.action.workflowType).toBe('DispatchDueBriefsWorkflow');
  });

  it('is idempotent: a second boot does not throw', async () => {
    // SchedulesBootstrap swallows ScheduleAlreadyRunning and the
    // ALREADY_EXISTS gRPC error from addSearchAttributes.
    secondApp = await createTestApp();
    expect(secondApp.app).toBeDefined();
  });
});
