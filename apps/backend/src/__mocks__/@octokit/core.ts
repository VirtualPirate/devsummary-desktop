/**
 * `@octokit/core` is ESM-only and Jest runs CJS.
 *
 * `plugin()` returns the class itself so `Octokit.plugin(paginateRest)` stays
 * constructible, and `request`/`paginate.iterator` are **static** jest mocks
 * shared by every instance — the client builds its Octokit lazily on the first
 * call, so a spec has nothing to reach for until after the call it is stubbing.
 */
const emptyPages = () => ({
  async *[Symbol.asyncIterator]() {},
});

export class Octokit {
  static request: jest.Mock = jest.fn(() => Promise.resolve({ data: {} }));
  static iterator: jest.Mock = jest.fn(emptyPages);
  /** Tokens every constructed instance was authenticated with, in order. */
  static __auths: unknown[] = [];

  static __reset() {
    Octokit.request.mockReset();
    Octokit.request.mockImplementation(() => Promise.resolve({ data: {} }));
    Octokit.iterator.mockReset();
    Octokit.iterator.mockImplementation(emptyPages);
    Octokit.__auths = [];
  }

  /** Arguments ignored — the mock is already "plugged in". */
  static plugin(): typeof Octokit {
    return Octokit;
  }

  request = Octokit.request;
  paginate = { iterator: Octokit.iterator };

  constructor(opts: { auth?: string } = {}) {
    Octokit.__auths.push(opts.auth);
  }
}
