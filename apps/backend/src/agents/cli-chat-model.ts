import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AppError } from '../common/errors';
import type { LlmClient, LlmSettings } from '../common/llm';

/**
 * A LangChain chat model over one of the four agent CLIs, built on this repo's
 * `LlmClient.parse()` structured-output seam.
 *
 * Stub. The real adapter lands with the CLI tool-calling work; until then a run
 * on a CLI provider fails the same way an unconfigured key provider does,
 * rather than the build failing or `AgentGraphService` growing a branch that
 * has to be removed again.
 */
export function createCliChatModel(
  _client: LlmClient,
  _settings: LlmSettings,
): BaseChatModel {
  throw AppError.OPENAI_NOT_CONFIGURED({
    reason: 'Agent CLIs are not wired yet',
  });
}
