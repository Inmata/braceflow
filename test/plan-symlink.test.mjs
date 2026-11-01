// R2 中 7：源计划/关联计划与 hooks 使用同一真实路径规则；文件链接别名不能指向业务文件。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { normalizePreparation } from '../src/preparation.mjs';
import { readState } from '../src/store.mjs';
import { emit, event, fixture } from './helpers.mjs';

test('源计划与 hooks 都拒绝 docs/plans 下指向业务文件的文件链接', async t => {
  const f = await fixture();
  await mkdir(path.join(f.project, 'src'), { recursive: true });
  await mkdir(path.join(f.project, 'docs', 'plans'), { recursive: true });
  await writeFile(path.join(f.project, 'src', 'business.md'), '# 业务文件\n');
  const alias = path.join(f.project, 'docs', 'plans', 'alias.md');
  try {
    await symlink(path.join(f.project, 'src', 'business.md'), alias, 'file');
  } catch (error) {
    // Windows 未开启开发者模式/缺少建链权限时如实跳过，不把未测写成通过。
    t.skip(`当前平台/账户无法创建文件链接：${error.code || error.message}`);
    return;
  }
  // normalizeSource：字面在 docs/plans、后缀也是 .md，但真实目标是业务文件，必须按链接拒绝。
  assert.throws(
    () => normalizePreparation({ size: 'simple', sizeReason: '链接别名', source: { path: 'docs/plans/alias.md' } }, { root: f.project }),
    error => error.code === 'PLAN' && /符号链接|junction/.test(error.message),
  );
  // hooks：准备阶段写入别名同样被拒，不能借 realpath 相等放行到业务文件。
  const denied = await event(f, 'PreToolUse', {
    tool_name: 'Write', tool_input: { file_path: alias, content: '通过别名改业务文件' },
  });
  assert.equal(denied.hookSpecificOutput?.permissionDecision, 'deny', JSON.stringify(denied));
});

test('关联计划与源计划同规则：任务只接受 docs/plans 下的 Markdown，拒绝业务文件与任意后缀', async () => {
  const business = await fixture();
  const outsidePlans = await emit(business, {
    action: 'task-start', goal: '计划范围', route: 'lead-direct', size: 'simple', sizeReason: '只验证计划范围',
    permissions: { mode: 'read-only', allowedPaths: [] }, plans: ['README.md'],
  });
  assert.equal(outsidePlans.result.accepted, false, JSON.stringify(outsidePlans.result));
  assert.equal(outsidePlans.result.reason, 'PLAN');
  assert.equal(Object.keys((await readState(business.directory)).tasks).length, 0);

  const suffix = await fixture();
  await mkdir(path.join(suffix.project, 'docs', 'plans'), { recursive: true });
  await writeFile(path.join(suffix.project, 'docs', 'plans', 'plan.txt'), '# 非 Markdown\n');
  const badSuffix = await emit(suffix, {
    action: 'task-start', goal: '计划后缀', route: 'lead-direct', size: 'simple', sizeReason: '只验证计划后缀',
    permissions: { mode: 'read-only', allowedPaths: [] }, plans: ['docs/plans/plan.txt'],
  });
  assert.equal(badSuffix.result.accepted, false, JSON.stringify(badSuffix.result));
  assert.equal(badSuffix.result.reason, 'PLAN');
  assert.match(badSuffix.result.message, /Markdown/);
});
