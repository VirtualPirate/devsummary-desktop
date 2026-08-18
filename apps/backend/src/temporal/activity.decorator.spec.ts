import { Reflector } from '@nestjs/core';
import { Activity } from './activity.decorator';
import { ACTIVITY_METADATA_KEY } from './temporal.tokens';

class Sample {
  @Activity('sample.do')
  doThing(): void {}
}

it('tags the method with its activity name', () => {
  const name = new Reflector().get<string>(
    ACTIVITY_METADATA_KEY,
    Sample.prototype.doThing,
  );
  expect(name).toBe('sample.do');
});
