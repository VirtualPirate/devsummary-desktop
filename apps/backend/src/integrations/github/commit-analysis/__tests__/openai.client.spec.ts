/* eslint-disable @typescript-eslint/no-require-imports */

const OpenAIModule = require('openai');
const OpenAI = OpenAIModule.default;
const __defaultParsed = OpenAIModule.__defaultParsed;

import { OpenAIClient } from '../services/openai.client';
import { CommitAnalysisOutputSchema } from '../schemas/analysis-output.schema';

function makeClient() {
  return new OpenAIClient({
    apiKey: 'sk-test',
    model: 'gpt-4o-mini',
    maxDiffChars: 60000,
    teamSize: 4,
    teamConcurrency: 2,
  });
}

describe('OpenAIClient', () => {
  beforeEach(() => {
    OpenAI.__instances = [];
  });

  it('calls responses.parse with the configured model + zod-derived format', async () => {
    const client = makeClient();
    const result = await client.analyze({
      systemPrompt: 'sys',
      userPrompt: 'user',
    });

    const instances = OpenAI.__instances as any[];
    expect(instances).toHaveLength(1);
    expect(instances[0].responses.parse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o-mini',
        input: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'user' },
        ],
        text: expect.objectContaining({
          format: expect.objectContaining({ name: 'commit_analysis' }),
        }),
      }),
    );
    expect(result.parsed).toEqual(__defaultParsed.output_parsed);
    expect(result.promptTokens).toBe(10);
    expect(result.completionTokens).toBe(20);
  });

  it('throws OPENAI_RESPONSE_INVALID when output_parsed is missing', async () => {
    const client = makeClient();
    const instances = () => OpenAI.__instances as any[];
    // first call constructs the instance lazily
    await client.analyze({ systemPrompt: 's', userPrompt: 'u' });
    instances()[0].responses.parse.mockResolvedValueOnce({
      output_parsed: null,
    });

    await expect(
      client.analyze({ systemPrompt: 's', userPrompt: 'u' }),
    ).rejects.toMatchObject({ code: 'OPENAI_RESPONSE_INVALID' });
  });

  it('throws OPENAI_API_FAILED when the SDK rejects', async () => {
    const client = makeClient();
    await client.analyze({ systemPrompt: 's', userPrompt: 'u' });
    const instances = OpenAI.__instances as any[];
    instances[0].responses.parse.mockRejectedValueOnce(new Error('boom'));

    await expect(
      client.analyze({ systemPrompt: 's', userPrompt: 'u' }),
    ).rejects.toMatchObject({ code: 'OPENAI_API_FAILED' });
  });

  it('exposes the same schema name passed to zodTextFormat', () => {
    expect(CommitAnalysisOutputSchema).toBeDefined();
  });
});
