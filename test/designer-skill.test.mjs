import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { linkDesignerSkill } from '../skills/workflow-designer/link.mjs';
import { root, temporary } from './helpers.mjs';

test('Designer Skill 链接创建、幂等、只读检查与冲突保护', async () => {
  const area = await temporary('designer-skill-');
  const targetRoot = path.join(area, 'skills');
  const target = path.join(targetRoot, 'workflow-designer');
  const expected = path.join(root, 'skills', 'workflow-designer');

  assert.equal((await linkDesignerSkill(targetRoot, { check: true })).status, 'missing');
  await assert.rejects(readFile(path.join(target, 'SKILL.md')), { code: 'ENOENT' });

  const created = await linkDesignerSkill(targetRoot);
  assert.equal(created.status, 'linked');
  assert.equal(created.existing, false);
  assert.equal(await readFile(path.join(target, 'SKILL.md'), 'utf8'), await readFile(path.join(expected, 'SKILL.md'), 'utf8'));

  const repeated = await linkDesignerSkill(targetRoot);
  assert.equal(repeated.status, 'linked');
  assert.equal(repeated.existing, true);
  assert.equal((await linkDesignerSkill(targetRoot, { check: true })).checked, true);

  const conflictRoot = path.join(area, 'conflict');
  const conflict = path.join(conflictRoot, 'workflow-designer');
  await mkdir(conflict, { recursive: true });
  await writeFile(path.join(conflict, 'keep.txt'), 'user content');
  const refused = await linkDesignerSkill(conflictRoot);
  assert.equal(refused.status, 'conflict');
  assert.equal(await readFile(path.join(conflict, 'keep.txt'), 'utf8'), 'user content');

  const cliRoot = path.join(area, 'cli');
  const command = spawnSync(process.execPath, [path.join(root, 'skills', 'workflow-designer', 'link.mjs'), '--target', cliRoot], { encoding: 'utf8' });
  assert.equal(command.status, 0, command.stderr);
  assert.equal(JSON.parse(command.stdout).status, 'linked');
});
