import { AgentGraphService } from '../services/agent-graph.service';
import { GEMINI_BASE_URL, type LlmSettings } from '../../common/llm';
import type { AgentsConfig } from '../agents.config';

/**
 * The one thing that has to be right about provider selection at runtime: the
 * key and the base URL travel together. A Gemini key sent to `api.openai.com`
 * comes back as a 401 that looks like a transport failure, and an OpenAI key
 * sent to Gemini's endpoint is the same in reverse.
 *
 * The second thing is that the choice is re-read per run. The settings screen
 * writes the provider and the key mid-session, so a model built once and kept
 * forever would need a relaunch — the same bug `LiveLlmClient` exists to avoid.
 */
function serviceFor(llm: () => LlmSettings | null): {
  service: AgentGraphService;
  getModel: () => any;
} {
  const config: AgentsConfig = {
    get llm() {
      return llm();
    },
  };
  const service = new AgentGraphService(
    config,
    null as never,
    null as never,
    null as never,
    null as never,
  );
  const getModel = (
    service as unknown as { getModel: () => any }
  ).getModel.bind(service);
  return { service, getModel };
}

const OPENAI: LlmSettings = {
  provider: 'openai',
  apiKey: 'sk-test',
  model: 'gpt-4o',
};

describe('AgentGraphService model', () => {
  it('leaves the SDK default base URL alone for openai', () => {
    const model = serviceFor(() => OPENAI).getModel();
    expect(model.model).toBe('gpt-4o');
    expect(model.apiKey).toBe('sk-test');
    expect(model.clientConfig?.baseURL).toBeUndefined();
  });

  it('points gemini at its OpenAI-compatible endpoint with its own key', () => {
    const model = serviceFor(() => ({
      provider: 'gemini',
      apiKey: 'g-test',
      baseURL: GEMINI_BASE_URL,
      model: 'gemini-3.6-flash',
    })).getModel();
    expect(model.model).toBe('gemini-3.6-flash');
    expect(model.apiKey).toBe('g-test');
    expect(model.clientConfig?.baseURL).toBe(GEMINI_BASE_URL);
  });

  it('reuses the model while provider, key and model are unchanged', () => {
    const { getModel } = serviceFor(() => ({ ...OPENAI }));
    expect(getModel()).toBe(getModel());
  });

  it('rebuilds it when the key is rotated or the model changed', () => {
    let settings: LlmSettings = { ...OPENAI };
    const { getModel } = serviceFor(() => settings);
    const first = getModel();

    settings = { ...OPENAI, apiKey: 'sk-rotated' };
    const second = getModel();
    expect(second).not.toBe(first);
    expect(second.apiKey).toBe('sk-rotated');

    settings = { ...OPENAI, apiKey: 'sk-rotated', model: 'gpt-4.1' };
    expect(getModel().model).toBe('gpt-4.1');
  });

  it('refuses to build anything when no provider is configured', () => {
    expect(() => serviceFor(() => null).getModel()).toThrow(
      /No AI provider is configured/,
    );
  });

  // The four CLI providers are spawned binaries, not an SDK; until their
  // LangChain adapter lands they fail the run the same way a missing key does.
  it('routes a CLI provider away from ChatOpenAI', () => {
    expect(() =>
      serviceFor(() => ({
        provider: 'claude-code',
        model: 'sonnet',
      })).getModel(),
    ).toThrow(/Agent CLIs are not wired yet/);
  });
});
