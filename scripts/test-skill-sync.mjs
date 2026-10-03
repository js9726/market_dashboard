import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256, renderFile, classifyStatus, resolveSourceRoot } from './skill-sync.mjs';

const skill = { id: 'fixture' };
const output = { target: 'fixture/knowledge.md' };
const sources = [{ root: 'wiki', path: 'wiki/test.md', content: '# Rule\nKeep evidence.\n', hash: sha256('# Rule\nKeep evidence.\n') }];

test('strict content validation detects upstream drift and tampering despite valid metadata', () => {
  const rendered = renderFile(skill, output, sources);
  assert.equal(classifyStatus(rendered.content, rendered, { strict: true }).fail, false);
  assert.equal(classifyStatus(rendered.content.replace('Keep evidence.', 'Invent evidence.'), rendered, { strict: true }).status, 'modified');
  const changed = renderFile(skill, output, [{ ...sources[0], content: '# Changed', hash: sha256('# Changed') }]);
  assert.equal(classifyStatus(rendered.content, changed, { strict: true }).status, 'stale');
  assert.equal(classifyStatus('# no metadata', rendered, { strict: true }).fail, true);
  assert.equal(classifyStatus(null, rendered, { strict: true }).fail, true);
});

test('LF and CRLF give identical source and body hashes', () => {
  assert.equal(sha256('a\nb\n'), sha256('a\r\nb\r\n'));
  const rendered = renderFile(skill, output, sources);
  assert.equal(classifyStatus(rendered.content.replace(/\n/g, '\r\n'), rendered, { strict: true }).fail, false);
});

test('explicit source override wins and invalid override cannot silently fall back', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'skill-sync-'));
  const old = process.env.SKILL_SYNC_TEST_ROOT;
  const manifest = { sourceRoots: { wiki: { candidates: ['${SKILL_SYNC_TEST_ROOT}', dir] } } };
  try {
    delete process.env.SKILL_SYNC_TEST_ROOT;
    assert.equal(await resolveSourceRoot(manifest, 'wiki'), dir);
    process.env.SKILL_SYNC_TEST_ROOT = dir;
    assert.equal(await resolveSourceRoot(manifest, 'wiki'), dir);
    process.env.SKILL_SYNC_TEST_ROOT = join(dir, 'absent');
    await assert.rejects(resolveSourceRoot(manifest, 'wiki'), /Explicit/);
    delete process.env.SKILL_SYNC_TEST_ROOT;
    assert.equal(await resolveSourceRoot({ sourceRoots: { wiki: { candidates: [join(dir, 'absent')] } } }, 'wiki'), null);
  } finally {
    if (old === undefined) delete process.env.SKILL_SYNC_TEST_ROOT; else process.env.SKILL_SYNC_TEST_ROOT = old;
    await rm(dir, { recursive: true });
  }
});

test('manifest defaults to pinned sources; planned skills remain disabled', async () => {
  const manifest = JSON.parse(await readFile(new URL('../packages/core-skills/skill-sync.manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.sourceRoots.wiki.candidates, ['${JIE_WIKI_ROOT}', 'packages/core-skills/wiki-source']);
  assert.deepEqual(manifest.sourceRoots.globalSkills.candidates, ['${JIE_WIKI_SKILLS_ROOT}', 'packages/core-skills/wiki-source/skills']);
  for (const s of manifest.skills.filter(s => s.status === 'planned')) assert.equal(s.enabled, false);
});
