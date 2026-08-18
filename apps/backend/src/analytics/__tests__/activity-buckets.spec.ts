import {
  BucketLimitExceededError,
  enumerateBucketKeys,
} from '../lib/activity-buckets';

describe('enumerateBucketKeys (day)', () => {
  it('enumerates UTC days over a half-open interval', () => {
    const keys = enumerateBucketKeys(
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-04T00:00:00Z'),
      'day',
      'UTC',
    );
    expect(keys).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
  });

  it('excludes the exclusive end bucket exactly at a boundary', () => {
    const keys = enumerateBucketKeys(
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-02T00:00:00Z'),
      'day',
      'UTC',
    );
    expect(keys).toEqual(['2026-06-01']);
  });

  it('respects the requested timezone for day boundaries', () => {
    // 2026-06-01T23:30Z is already 2026-06-02 in Asia/Karachi (UTC+5)
    const keys = enumerateBucketKeys(
      new Date('2026-06-01T23:30:00Z'),
      new Date('2026-06-02T23:30:00Z'),
      'day',
      'Asia/Karachi',
    );
    expect(keys).toEqual(['2026-06-02', '2026-06-03']);
  });

  it('handles a DST spring-forward day without gaps or duplicates', () => {
    // America/New_York DST began 2026-03-08 (23-hour local day)
    const keys = enumerateBucketKeys(
      new Date('2026-03-07T05:00:00Z'), // 2026-03-07 00:00 EST
      new Date('2026-03-10T04:00:00Z'), // 2026-03-10 00:00 EDT
      'day',
      'America/New_York',
    );
    expect(keys).toEqual(['2026-03-07', '2026-03-08', '2026-03-09']);
  });

  it('returns [] when to <= from', () => {
    const at = new Date('2026-06-01T00:00:00Z');
    expect(enumerateBucketKeys(at, at, 'day', 'UTC')).toEqual([]);
  });
});

describe('enumerateBucketKeys (week)', () => {
  it('aligns buckets to ISO Mondays', () => {
    // 2026-06-10 is a Wednesday; its ISO week starts Monday 2026-06-08
    const keys = enumerateBucketKeys(
      new Date('2026-06-10T00:00:00Z'),
      new Date('2026-06-22T00:00:00Z'),
      'week',
      'UTC',
    );
    expect(keys).toEqual(['2026-06-08', '2026-06-15']);
  });
});

describe('bucket limit', () => {
  it('throws BucketLimitExceededError above maxBuckets', () => {
    expect(() =>
      enumerateBucketKeys(
        new Date('2020-01-01T00:00:00Z'),
        new Date('2026-01-01T00:00:00Z'),
        'day',
        'UTC',
        800,
      ),
    ).toThrow(BucketLimitExceededError);
  });

  it('does not throw at exactly maxBuckets', () => {
    const keys = enumerateBucketKeys(
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-03T00:00:00Z'),
      'day',
      'UTC',
      2,
    );
    expect(keys).toHaveLength(2);
  });
});
