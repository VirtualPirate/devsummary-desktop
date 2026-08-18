export class App {
  static __mockInstances: App[] = [];

  static __reset() {
    App.__mockInstances = [];
  }

  appId: number | string;
  privateKey: string;
  octokit: { request: jest.Mock };
  getInstallationOctokit: jest.Mock;
  eachRepository: { iterator: jest.Mock };

  constructor(opts: { appId: number | string; privateKey: string }) {
    this.appId = opts.appId;
    this.privateKey = opts.privateKey;
    this.octokit = { request: jest.fn(() => Promise.resolve({ data: {} })) };
    this.getInstallationOctokit = jest.fn(() =>
      Promise.resolve({
        request: jest.fn(() => Promise.resolve({ data: {} })),
        paginate: {
          iterator: jest.fn(() => ({
            async *[Symbol.asyncIterator]() {},
          })),
        },
      }),
    );
    this.eachRepository = {
      iterator: jest.fn(() => ({
        async *[Symbol.asyncIterator]() {},
      })),
    };
    App.__mockInstances.push(this);
  }
}
