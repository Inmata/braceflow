import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { DIGEST_DAYS, learningDigest } from '../src/digest.mjs';
import { putItem, readItems, renderEntry } from '../src/learning.mjs';
import { projectFor, setLearningEnabled } from '../src/learning-config.mjs';
import { mutate, readState } from '../src/store.mjs';
import { cli, fixture } from './helpers.mjs';

const DAY = 86400000;
const NOW = new Date('2026-11-03T12:00:00.000Z');
const at = offset => new Date(NOW.getTime() + offset).toISOString();
const within = at(-3600000);
const outside = at(-8 * DAY);

function knowledge(id, { status = 'active', maturity = 'stable', history = [], title = id } = {}) {
  return {
    schemaVersion: 1, id, generation: 1, title, summary: '摘要 ' + id, conditions: '通用', type: 'method',
    importance: 'normal', status, scope: { paths: [], version: null }, tags: [],
    evidence: [{ id: 'e1', incidentId: 'incident-' + id, kind: 'success', verified: true, createdAt: '2026-10-01T10:00:00Z', generation: 1 }],
    history, supersedes: null, maturity,
  };
}
async function putKnowledge(f, value) {
  const folder = path.join(f.project, '.workflow', 'knowledge');
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, value.id + '.md'), renderEntry(value));
}
async function item(f, folder, value) {
  await putItem(f.directory, await projectFor(f.directory, f.project), folder, value);
}
async function digest(f, options = {}) {
  return learningDigest(f.directory, f.project, { now: NOW, ...options });
}
async function snapshot(folder) {
  const names = await readdir(folder, { recursive: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const files = {};
  for (const name of names.sort()) {
    const full = path.join(folder, name);
    if ((await stat(full)).isFile()) files[name.split(path.sep).join('/')] = await readFile(full, 'utf8');
  }
  return files;
}

test('learning digest 默认 7 天并输出窗口起止与天数', async () => {
  const f = await fixture();
  await setLearningEnabled(f.directory, f.project, true);
  await item(f, 'inbox', { id: 'm-in', incidentId: 'i-1', kind: 'success', status: 'pending', createdAt: within });
  await item(f, 'inbox', { id: 'm-out', incidentId: 'i-2', kind: 'success', status: 'pending', createdAt: outside });
  const result = await digest(f);
  assert.equal(DIGEST_DAYS, 7);
  assert.equal(result.window.days, 7);
  assert.equal(result.window.start, new Date(NOW.getTime() - 7 * DAY).toISOString());
  assert.equal(result.window.end, NOW.toISOString());
  assert.equal(result.materials.total, 1);
  assert.equal(result.materials.pending, 1);
});

test('learning digest 接受 1 天和 90 天边界', async () => {
  const f = await fixture();
  await item(f, 'inbox', { id: 'm-30m', incidentId: 'i-30m', kind: 'success', status: 'pending', createdAt: at(-1800000) });
  await item(f, 'inbox', { id: 'm-2d', incidentId: 'i-2d', kind: 'success', status: 'pending', createdAt: at(-2 * DAY) });
  await item(f, 'inbox', { id: 'm-91d', incidentId: 'i-91d', kind: 'success', status: 'pending', createdAt: at(-91 * DAY) });
  const one = await digest(f, { days: 1 });
  assert.equal(one.window.days, 1);
  assert.equal(one.materials.total, 1);
  const ninety = await digest(f, { days: 90 });
  assert.equal(ninety.window.days, 90);
  assert.equal(ninety.materials.total, 2);
});

test('learning digest 拒绝非法天数，CLI 退出非零', async () => {
  const f = await fixture();
  for (const days of [0, 91, 1.5, Number.NaN]) {
    await assert.rejects(digest(f, { days }), { code: 'ARGUMENT' });
  }
  const rejected = cli(['learning', 'digest', '--state-dir', f.directory, '--root', f.project, '--days', '0']);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stdout, /1 到 90/);
  const accepted = cli(['learning', 'digest', '--state-dir', f.directory, '--root', f.project, '--days', '1']);
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).window.days, 1);
});

test('learning digest 空窗口给出完整零值分桶', async () => {
  const f = await fixture();
  const state = JSON.parse(JSON.stringify(await readState(f.directory)));
  const result = await digest(f);
  assert.deepEqual(result.materials, { total: 0, pending: 0, waiting: 0, processed: 0 });
  assert.deepEqual(result.runs, { total: 0, completed: 0, partial: 0, failed: 0, timeout: 0, rejected: 0, unhandled: 0 });
  assert.deepEqual(result.knowledge, { available: true, created: 0, revised: 0, stable: 0, standing: [] });
  assert.deepEqual(result.repeated, []);
  assert.deepEqual(result.unresolved, { disputed: [], counterEvidence: [], conflicts: [] });
  assert.deepEqual(result.capture, { total: 0, pending: 0, running: 0, completed: 0, skipped: 0, failed: 0, timeout: 0, candidates: 0, rejected: 0 });
  assert.deepEqual(result.feedback, { shown: 0, adopted: 0, total: 0, note: '仅显式记录，不等于采纳或成功' });
  assert.deepEqual(JSON.parse(JSON.stringify(await readState(f.directory))), state);
});

test('learning digest 分桶计数、重复项与未解决项，且不写状态或 shown', async () => {
  const f = await fixture();
  await setLearningEnabled(f.directory, f.project, true);
  for (const [id, incidentId, status, createdAt] of [
    ['m-1', 'i-repeat', 'pending', within],
    ['m-2', 'i-repeat', 'waiting', within],
    ['m-3', 'i-single', 'processed', within],
    ['m-old', 'i-repeat', 'pending', outside],
  ]) await item(f, 'inbox', { id, incidentId, kind: 'success', status, createdAt });
  for (const [id, status, rejected, unhandled] of [
    ['r-completed', 'completed', [], []],
    ['r-partial', 'partial', [{ code: 'RESULT' }, { code: 'EVIDENCE' }], []],
    ['r-failed', 'failed', [{ code: 'RESULT' }], ['m-1', 'm-2']],
    ['r-timeout', 'timeout', [], []],
    ['r-conflict', 'conflict', [], []],
    ['r-outside', 'completed', [{ code: 'RESULT' }], []],
  ]) await item(f, 'runs', { id, status, startedAt: id === 'r-outside' ? outside : within, rejected, unhandled });
  for (const [id, status, createdAt, candidates, rejected] of [
    ['j-completed', 'completed', within, 2, [{ code: 'EVIDENCE' }]],
    ['j-failed', 'failed', within, 1, []],
    ['j-pending', 'pending', within, 0, []],
    ['j-outside', 'completed', outside, 9, []],
  ]) await item(f, 'capture', { id, status, createdAt, candidates, rejected });
  for (const [id, outcome, createdAt] of [
    ['f-shown', 'shown', within],
    ['f-adopted', 'adopted', within],
    ['f-old', 'shown', outside],
  ]) await item(f, 'feedback', { id, outcome, createdAt });

  await putKnowledge(f, knowledge('K-stand', { title: '常驻规则', history: [{ at: within, action: 'create' }] }));
  await putKnowledge(f, knowledge('K-disputed', { status: 'disputed', maturity: 'unverified', history: [{ at: within, action: 'revise' }] }));
  await putKnowledge(f, knowledge('K-old', { status: 'retired', maturity: 'unverified', history: [{ at: outside, action: 'create' }] }));
  await mutate(f.directory, async state => {
    state.projects[f.projectId].learning.disputes = {
      'K-disputed': { observationId: 'm-old', reason: '旧结论被反驳', at: within },
    };
  });

  const stateFolder = path.join(f.directory, 'projects', f.projectId);
  const before = await snapshot(stateFolder);
  const result = await digest(f);

  assert.deepEqual(result.materials, { total: 3, pending: 1, waiting: 1, processed: 1 });
  assert.deepEqual(result.runs, { total: 5, completed: 1, partial: 1, failed: 1, timeout: 1, rejected: 3, unhandled: 2 });
  assert.deepEqual(result.knowledge, {
    available: true, created: 1, revised: 1, stable: 1,
    standing: [{ id: 'K-stand', title: '常驻规则', seen: 1, dates: 1, lastSeen: '2026-10-01' }],
  });
  assert.deepEqual(result.repeated, [{ incidentId: 'i-repeat', count: 2, ids: ['m-1', 'm-2'] }]);
  assert.deepEqual(result.unresolved.disputed, [{ id: 'K-disputed', title: 'K-disputed' }]);
  assert.deepEqual(result.unresolved.counterEvidence, [{ knowledgeId: 'K-disputed', observationId: 'm-old', reason: '旧结论被反驳', at: within }]);
  assert.deepEqual(result.unresolved.conflicts, [{ id: 'r-conflict', status: 'conflict', reason: null, startedAt: within }]);
  assert.deepEqual(result.capture, { total: 3, pending: 1, running: 0, completed: 1, skipped: 0, failed: 1, timeout: 0, candidates: 3, rejected: 1 });
  assert.deepEqual(result.feedback, { shown: 1, adopted: 1, total: 2, note: '仅显式记录，不等于采纳或成功' });
  const after = await snapshot(stateFolder);
  assert.deepEqual(after, before);
  assert.equal(after['knowledge-index.json'], undefined);
  const feedback = await readItems(f.directory, await projectFor(f.directory, f.project), 'feedback');
  assert.deepEqual(feedback.map(value => value.id).sort(), ['f-adopted', 'f-old', 'f-shown']);
});

test('learning digest 计入冲突运行提案中保留的未处置材料', async () => {
  const f = await fixture();
  await item(f, 'runs', { id: 'r-conflict', status: 'conflict', startedAt: within, rejected: [], proposal: { unhandled: ['m-1', 'm-2'] } });
  const result = await digest(f);
  assert.equal(result.runs.total, 1);
  assert.equal(result.runs.unhandled, 2);
  assert.deepEqual(result.unresolved.conflicts, [{ id: 'r-conflict', status: 'conflict', reason: null, startedAt: within }]);
});
