import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncMarket } from './sync-market-dashboard.mjs';

test('copy preserves timestamps and literal NaN text; rejects regression and invalid JSON before writing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'market-sync-'));
  const src = join(dir, 'source'), dst = join(dir, 'public');
  await mkdir(src); await mkdir(dst);
  try {
    const newer = JSON.stringify({ built_at: '2026-10-02T20:00:00Z', note: 'NaN Infinity -Infinity' });
    await writeFile(join(src, 'snapshot.json'), newer);
    assert.equal(await syncMarket(src, dst), 1);
    assert.equal(await readFile(join(dst, 'snapshot.json'), 'utf8'), newer);
    await writeFile(join(src, 'snapshot.json'), JSON.stringify({ built_at: '2026-10-01T20:00:00Z' }));
    await assert.rejects(syncMarket(src, dst), /Refusing older/);
    assert.equal(await readFile(join(dst, 'snapshot.json'), 'utf8'), newer);
    await writeFile(join(src, 'snapshot.json'), newer);
    await writeFile(join(src, 'bad.json'), '{"value":NaN}');
    await assert.rejects(syncMarket(src, dst), SyntaxError);
    await writeFile(join(src, 'bad.json'), '{"nested":{"value":1e400}}');
    await assert.rejects(syncMarket(src, dst), /Non-finite JSON number/);
    assert.equal(await readFile(join(dst, 'snapshot.json'), 'utf8'), newer);
  } finally { await rm(dir, { recursive: true }); }
});
