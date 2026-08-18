import { NoopActivity } from './noop.activity';

it('logs the message without throwing', async () => {
  await expect(new NoopActivity().run('hi')).resolves.toBeUndefined();
});
