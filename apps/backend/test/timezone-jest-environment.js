const { TestEnvironment: NodeEnvironment } = require('jest-environment-node');

/**
 * Runs a test file with the *process* timezone pinned, so a test can prove that
 * production code does not read the server's zone.
 *
 * `process.env.TZ = ...` inside a test file does nothing: jest's sandbox
 * `process.env` never reaches V8's timezone cache, so `new Date(y, m, d, h, m)`
 * keeps resolving in the zone jest booted with. An environment runs outside the
 * sandbox, where the assignment does take effect. Plain JS because jest loads
 * environments without applying the TypeScript transform.
 *
 * Usage, per test file:
 *
 *   /**
 *    * @jest-environment <rootDir>/../test/timezone-jest-environment.js
 *    * @jest-environment-options {"timezone": "America/Santiago"}
 *    *\/
 */
class TimezoneEnvironment extends NodeEnvironment {
  constructor(config, context) {
    const previousTz = process.env.TZ;
    const { timezone } = config.projectConfig.testEnvironmentOptions;
    if (timezone) process.env.TZ = timezone;
    super(config, context);
    this.previousTz = previousTz;
  }

  // Test files share a worker process, so hand the zone back or every later
  // file in that worker inherits it.
  async teardown() {
    if (this.previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = this.previousTz;
    await super.teardown();
  }
}

module.exports = TimezoneEnvironment;
