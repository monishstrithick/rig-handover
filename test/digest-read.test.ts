import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28');

  it('reads 5 jobs sorted by name and counts the truncated last line as bad', () => {
    expect(night).not.toBeNull();
    expect(night!.night).toBe('2026-10-28');
    expect(night!.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(night!.badLines).toBe(1);
  });

  it('keeps a job whose owner is null', () => {
    const row = night!.rows.find((r) => r.job === 'digest/render');
    expect(row).toEqual({
      job: 'digest/render',
      owner: null,
      runs: 1,
      retries: 0,
      lastStatus: 'ok',
      lastError: null,
      first: '2026-10-29T05:41:09+01:00',
      last: '2026-10-29T05:41:09+01:00',
    });
  });

  it('folds retries and keeps the last error', () => {
    const row = night!.rows.find((r) => r.job === 'fixtures/refresh');
    expect(row).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      first: '2026-10-29T01:30:00+01:00',
      last: '2026-10-29T01:37:00+01:00',
    });
  });

  it('reports a failed job with its error', () => {
    const row = night!.rows.find((r) => r.job === 'notes/backup');
    expect(row).toMatchObject({ owner: 'lane-07', runs: 1, lastStatus: 'fail', lastError: 'quota exceeded' });
  });

  it('keeps times with their offset', () => {
    const row = night!.rows.find((r) => r.job === 'lane/sync');
    expect(row).toMatchObject({
      runs: 8,
      retries: 1,
      lastStatus: 'ok',
      lastError: 'lock held',
      first: '2026-10-28T23:00:06+01:00',
      last: '2026-10-29T05:00:04+01:00',
    });
  });

  it('counts parsed lines per status', () => {
    expect(night!.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });
});

describe('readNight edge cases', () => {
  let dir: string | undefined;
  const tmp = (): string => (dir = mkdtempSync(join(tmpdir(), 'rig-digest-')));
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('returns null when the night has no file', () => {
    expect(readNight(tmp(), '2026-01-01')).toBeNull();
  });

  it('returns an empty Night for an empty file', () => {
    const d = tmp();
    writeFileSync(join(d, '2026-01-01.jsonl'), '');
    expect(readNight(d, '2026-01-01')).toEqual({
      night: '2026-01-01',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('skips blank lines and counts shape mismatches as bad', () => {
    const d = tmp();
    writeFileSync(
      join(d, '2026-01-02.jsonl'),
      [
        '{"at":"2026-01-02T01:00:00+02:00","job":"a","status":"ok","owner":"x"}',
        '',
        '{"at":"2026-01-02T02:00:00+02:00","job":"a","status":"weird","owner":"x"}',
        '{"at":"2026-01-02T03:00:00+02:00","job":"a","status":"ok"}',
        '[1,2]',
        '{"at":"2026-01-02T04:00:00+02:00","job":"a","status":"fail","owner":null,"error":"boom"}',
        '',
      ].join('\n'),
    );
    const n = readNight(d, '2026-01-02');
    expect(n!.badLines).toBe(3);
    expect(n!.counts).toEqual({ ok: 1, retry: 0, fail: 1 });
    expect(n!.rows).toEqual([
      {
        job: 'a',
        owner: null,
        runs: 2,
        retries: 0,
        lastStatus: 'fail',
        lastError: 'boom',
        first: '2026-01-02T01:00:00+02:00',
        last: '2026-01-02T04:00:00+02:00',
      },
    ]);
  });
});
