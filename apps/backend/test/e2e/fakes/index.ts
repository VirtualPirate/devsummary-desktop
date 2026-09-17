import { installAgentCli, type AgentCliFake } from './agent-cli';
import { installGithub, type GithubFake } from './github';
import { installLlm, type LlmFake } from './llm';
import { installShell, type ShellFake } from './shell';
import { installSlack, type SlackFake } from './slack';
import { defineWorld, type World } from './world';

export interface Fakes {
  world: World;
  github: GithubFake;
  llm: LlmFake;
  agentCli: AgentCliFake;
  slack: SlackFake;
  shell: ShellFake;
  teardown: () => Promise<void>;
}

/**
 * All five outbound seams at once, for a spec that needs the whole boundary.
 * A spec that needs two installs two — this is convenience, not ceremony.
 *
 * Call it in `beforeAll` **before** `createTestApp`, so nothing is constructed
 * against an un-stubbed client.
 */
export async function installFakes(world: World = defineWorld()): Promise<Fakes> {
  const github = await installGithub(world);
  const llm = await installLlm();
  const agentCli = await installAgentCli();
  const slack = await installSlack();
  const shell = installShell();

  return {
    world,
    github,
    llm,
    agentCli,
    slack,
    shell,
    teardown: async () => {
      shell.restore();
      await agentCli.teardown();
    },
  };
}

export { defineWorld, daysAgo, seedWorld } from './world';
export type { World, WorldRepo, WorldCommit } from './world';
