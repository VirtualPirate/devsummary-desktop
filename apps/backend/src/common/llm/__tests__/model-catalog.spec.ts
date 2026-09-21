import { AGENT_ADAPTERS, type AgentCliDetector } from '../agents';
import { listProviderModels } from '../model-catalog';

/** Real coloured `agent --list-models` output — `FORCE_COLOR=1`, which is what
 *  both pnpm and the Electron shell export. */
const CURSOR_STDOUT_COLOURED =
  '\u001b[1mAvailable models\u001b[22m\n\n' +
  '\u001b[36mauto\u001b[39m \u001b[2m- Auto\u001b[22m\u001b[2m (default)\u001b[22m\n' +
  '\u001b[36mcomposer-2.5\u001b[39m \u001b[2m- Composer 2.5\u001b[22m\n';

/** Real `agent --list-models` output, header and all. */
const CURSOR_STDOUT = `Available models

auto - Auto (default)
composer-2.5 - Composer 2.5 (current)
gpt-5.6-sol-high - GPT-5.6 Sol 1M High
`;

/** Real `opencode models` output. */
const OPENCODE_STDOUT = `opencode/big-pickle
openai/gpt-5.6-terra
`;

const parseOf = (id: 'cursor' | 'opencode') => {
  const catalogue = AGENT_ADAPTERS[id].models;
  if (!('parse' in catalogue))
    throw new Error(`${id} has no catalogue command`);
  return catalogue.parse;
};

describe('agent CLI model catalogues', () => {
  it('takes the id out of each cursor line and drops the header', () => {
    expect(parseOf('cursor')(CURSOR_STDOUT)).toEqual([
      'auto',
      'composer-2.5',
      'gpt-5.6-sol-high',
    ]);
  });

  it('keeps opencode ids whole', () => {
    expect(parseOf('opencode')(OPENCODE_STDOUT)).toEqual([
      'opencode/big-pickle',
      'openai/gpt-5.6-terra',
    ]);
  });
});

describe('listProviderModels', () => {
  it('reads a coloured catalogue, because FORCE_COLOR is set where this runs', async () => {
    const detector = {
      binaryPath: jest.fn().mockResolvedValue('/usr/bin/agent'),
    } as unknown as AgentCliDetector;
    const run = jest.fn().mockResolvedValue({
      code: 0,
      stdout: CURSOR_STDOUT_COLOURED,
      stderr: '',
      timedOut: false,
    });

    await expect(
      listProviderModels('cursor', undefined, detector, run),
    ).resolves.toEqual(['auto', 'composer-2.5']);
  });

  const detector = {
    binaryPath: jest.fn().mockResolvedValue(null),
  } as unknown as AgentCliDetector;

  it('answers a CLI with no catalogue command from its fixed list', async () => {
    await expect(
      listProviderModels('claude-code', undefined, detector),
    ).resolves.toContain('sonnet');
  });

  it('answers empty when the binary is missing', async () => {
    await expect(
      listProviderModels('cursor', undefined, detector),
    ).resolves.toEqual([]);
  });

  it('answers empty for a keyed provider with no key', async () => {
    await expect(
      listProviderModels('openai', undefined, detector),
    ).resolves.toEqual([]);
  });

  it('strips gemini `models/` prefixes and drops what cannot chat', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'models/gemini-3.1-flash-lite' },
          { id: 'models/text-embedding-004' },
          { id: 'models/imagen-4.0-generate' },
        ],
      }),
    });
    global.fetch = fetchMock;

    await expect(
      listProviderModels('gemini', 'key', detector),
    ).resolves.toEqual(['gemini-3.1-flash-lite']);
    expect(fetchMock.mock.calls[0][0]).toContain('/openai/models');
  });

  it('answers empty when the listing call fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false });

    await expect(
      listProviderModels('openai', 'key', detector),
    ).resolves.toEqual([]);
  });
});
