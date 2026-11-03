import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Night } from '../src/digest/types.js';

const dir = mkdtempSync(join(tmpdir(), 'rig-'));
const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: dir };

const real = readFileSync(join('runs', '2026-10-28.jsonl'), 'utf8');

beforeAll(() => {
  writeFileSync(join(dir, '2026-10-28.jsonl'), real);
  writeFileSync(join(dir, '2026-10-30.jsonl'), '');
  writeFileSync(join(dir, '2026-10-31.jsonl'), `${real.trimEnd()}\nthis is not json\n`);
});

const app = () => createApp(config);

async function json(night: string) {
  const res = await app().request(`/api/digest/${night}`);
  return { res, body: (await res.json()) as Night };
}

describe('GET /digest/:night', () => {
  it('200 with one row per job, warn rows flagged, null owner as an em dash', async () => {
    const { body } = await json('2026-10-28');
    const res = await app().request('/digest/2026-10-28');
    const html = await res.text();
    expect(res.status).toBe(200);
    for (const row of body.rows) expect(html).toContain(row.job);
    const warns = body.rows.filter((r) => r.retries >= 3 || r.lastStatus === 'fail').length;
    expect(warns).toBeGreaterThan(0);
    expect(html.match(/class="warn"/g)?.length ?? 0).toBe(warns);
    expect(body.rows.some((r) => r.owner === null)).toBe(true);
    expect(html).toContain('—');
  });

  it('empty night is 200 and says nothing ran', async () => {
    const res = await app().request('/digest/2026-10-30');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('404 for a night with no file', async () => {
    const res = await app().request('/digest/2020-01-01');
    expect(res.status).toBe(404);
  });

  it('a night with a bad line is still 200 and renders its good jobs', async () => {
    const { body } = await json('2026-10-31');
    const res = await app().request('/digest/2026-10-31');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(body.rows.length).toBeGreaterThan(0);
    for (const row of body.rows) expect(html).toContain(row.job);
  });
});

describe('GET /api/digest/:night', () => {
  it('200 with the Night object, rows sorted by job', async () => {
    const { res, body } = await json('2026-10-28');
    expect(res.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['badLines', 'counts', 'night', 'rows']);
    expect(body.night).toBe('2026-10-28');
    expect(body.badLines).toBe(0);
    expect(body.rows.length).toBeGreaterThan(0);
    const jobs = body.rows.map((r) => r.job);
    expect(jobs).toEqual([...jobs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(body.counts.ok + body.counts.retry + body.counts.fail).toBe(real.trim().split('\n').length);
  });

  it('404 for a night with no file', async () => {
    const res = await app().request('/api/digest/2020-01-01');
    expect(res.status).toBe(404);
  });

  it('empty night is 200 with no rows', async () => {
    const { res, body } = await json('2026-10-30');
    expect(res.status).toBe(200);
    expect(body.rows).toEqual([]);
    expect(body.badLines).toBe(0);
  });

  it('a bad line is counted, not thrown', async () => {
    const { res, body } = await json('2026-10-31');
    expect(res.status).toBe(200);
    expect(body.badLines).toBe(1);
  });
});

describe('page and JSON agree', () => {
  it('job names appear on the page in the same order as JSON rows', async () => {
    const { body } = await json('2026-10-28');
    const html = await (await app().request('/digest/2026-10-28')).text();
    const positions = body.rows.map((r) => html.indexOf(r.job));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
