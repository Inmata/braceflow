#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import { lstat, mkdir, readFile, realpath, symlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = path.dirname(fileURLToPath(import.meta.url));
const samePath = (left, right) => path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
const output = result => {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (['conflict', 'mismatch', 'error'].includes(result.status)) process.exitCode = 1;
};

function argumentsFor(argv) {
  const options = { check: false, target: path.join(os.homedir(), '.agents', 'skills') };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--check' && !options.check) options.check = true;
    else if (argv[index] === '--target' && argv[index + 1] && !argv[index + 1].startsWith('--')) options.target = argv[++index];
    else throw new Error(`未知或重复参数：${argv[index]}`);
  }
  return options;
}

export async function linkDesignerSkill(targetRoot, { check = false } = {}) {
  const target = path.join(path.resolve(targetRoot), 'workflow-designer');
  const expected = await realpath(source);
  await readFile(path.join(expected, 'SKILL.md'), 'utf8');
  const info = await lstat(target).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (info) {
    if (!info.isSymbolicLink()) return { status: 'conflict', source: expected, target, message: '目标已存在且不是目录链接；未覆盖' };
    const actual = await realpath(target).catch(() => null);
    if (!actual || !samePath(actual, expected)) return { status: 'mismatch', source: expected, target, actual, message: '链接没有指向当前 Skill；未改动' };
    return { status: 'linked', source: expected, target, existing: true, checked: check };
  }
  if (check) return { status: 'missing', source: expected, target };
  await mkdir(path.dirname(target), { recursive: true });
  await symlink(expected, target, 'junction');
  return { status: 'linked', source: expected, target, existing: false };
}

if (process.argv[1] && path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))) {
  try {
    const options = argumentsFor(process.argv.slice(2));
    output(await linkDesignerSkill(options.target, { check: options.check }));
  } catch (error) {
    output({ status: 'error', message: error.message });
  }
}
