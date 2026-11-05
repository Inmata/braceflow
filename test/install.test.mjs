import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { doctor, HOSTS, install, uninstall, RELEASE_PATHS } from '../src/install.mjs';
import { digest, mutate, readState } from '../src/store.mjs';
import { createPending } from '../src/knowledge.mjs';
import { emit, fixture, identity, root, start, temporary as makeTemporary } from './helpers.mjs';

// 安装器用宿主默认目录判断权威位置。测试把每个临时目录当作该宿主的主目录，避免读写真实 ~/.codex。
const temporary = async prefix => {
  const area = await makeTemporary(prefix);
  HOSTS.codex.defaultUserDir = () => path.join(area, '.codex');
  HOSTS.claude.defaultUserDir = () => path.join(area, '.claude');
  return area;
};

test('V14 临时用户目录安装/重复安装/撤销保留其他插件和新增配置', async () => {
  const area = await temporary('install-');
  HOSTS.codex.defaultUserDir = () => path.join(area, 'user', '.codex');
  const directory = path.join(area, 'state');
  const userDir = path.join(area, 'user', '.codex');
  await mkdir(userDir, { recursive: true });
  const old = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'other-plugin-hook' }] }] }, userAdded: { preserve: true } };
  await writeFile(path.join(userDir, 'hooks.json'), JSON.stringify(old));
  const installed = await install(directory, { userDir });
  assert.equal(installed.status, 'installed');
  const once = await readFile(path.join(userDir, 'hooks.json'), 'utf8');
  assert.equal((await install(directory, { userDir })).status, 'already-installed');
  assert.equal(await readFile(path.join(userDir, 'hooks.json'), 'utf8'), once);
  const info = await doctor(directory);
  assert.equal(info.registration, 'registered');
  assert.equal(info.discovery, 'unknown');
  assert.equal(info.trust, 'unknown');
  assert.equal(info.execution, 'unknown');
  assert.equal(info.integrity, 'verified');
  const after = JSON.parse(once);
  after.hooks.Stop.push({ hooks: [{ type: 'command', command: 'later-user-hook' }] });
  await writeFile(path.join(userDir, 'hooks.json'), JSON.stringify(after));
  assert.equal((await uninstall(directory)).status, 'uninstalled');
  const restored = JSON.parse(await readFile(path.join(userDir, 'hooks.json'), 'utf8'));
  assert.deepEqual(restored.userAdded, old.userAdded);
  assert.deepEqual(restored.hooks.Stop.map(group => group.hooks[0].command), ['other-plugin-hook', 'later-user-hook']);
  assert.equal((await uninstall(directory)).status, 'not-installed');
});
test('V14 hook 指向固定入口 current，升级只替换链接目标', async () => {
  const area = await temporary('install-current-');
  const directory = path.join(area, 'state');
  const userDir = path.join(area, '.codex');
  const first = await install(directory, { userDir });
  const link = path.join(directory, 'current');
  assert.equal(await fs.realpath(link), await fs.realpath(first.releaseRoot));
  const configFile = path.join(userDir, 'hooks.json');
  const command = JSON.parse(await readFile(configFile, 'utf8')).hooks.SessionStart[0].hooks[0].command;
  assert.ok(command.includes('/current/'), command);
  assert.ok(!command.includes('/releases/'), command);
  const once = await readFile(configFile, 'utf8');
  assert.equal((await install(directory, { userDir })).status, 'already-installed');
  assert.equal(await readFile(configFile, 'utf8'), once);
  // 源码变化后升级：入口指向新快照，hook 命令字符串保持不变。
  const source = path.join(area, 'source');
  await fs.cp(root, source, { recursive: true, filter: item => !item.includes('.git') && !item.includes('node_modules') });
  await fs.appendFile(path.join(source, 'README.md'), '\n升级标记\n');
  const second = await install(directory, { userDir, sourceRoot: source });
  assert.equal(second.status, 'installed');
  assert.notEqual(second.releaseRoot, first.releaseRoot);
  assert.equal(await fs.realpath(link), await fs.realpath(second.releaseRoot));
  assert.equal(JSON.parse(await readFile(configFile, 'utf8')).hooks.SessionStart[0].hooks[0].command, command);
  // 入口被换成普通目录时 doctor 报告不可用。
  await fs.unlink(link);
  await fs.mkdir(link);
  assert.equal((await doctor(directory)).integrity, 'unavailable');
});
test('V14 升级重装保持自有分组原位置，不打乱其他插件的信任序号', async () => {
  const area = await temporary('install-order-');
  const directory = path.join(area, 'state');
  const userDir = path.join(area, '.codex');
  const configFile = path.join(userDir, 'hooks.json');
  await install(directory, { userDir });
  // 其他插件后装：一个排在本插件之前，一个排在之后。
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  config.hooks.SessionStart.unshift({ hooks: [{ type: 'command', command: 'plugin-before' }] });
  config.hooks.SessionStart.push({ hooks: [{ type: 'command', command: 'plugin-after' }] });
  await writeFile(configFile, JSON.stringify(config));
  const source = path.join(area, 'source');
  await fs.cp(root, source, { recursive: true, filter: item => !item.includes('.git') && !item.includes('node_modules') });
  await fs.appendFile(path.join(source, 'README.md'), '\n升级标记\n');
  assert.equal((await install(directory, { userDir, sourceRoot: source })).status, 'installed');
  const commands = JSON.parse(await readFile(configFile, 'utf8')).hooks.SessionStart.map(group => group.hooks[0].command);
  assert.equal(commands.length, 3);
  assert.equal(commands[0], 'plugin-before');
  assert.ok(commands[1].includes('workflow.mjs'), commands[1]);
  assert.equal(commands[2], 'plugin-after');
});
test('V14 自有 handler 被手改时撤销不覆盖，发布副本被改时停止维护', async () => {
  const area = await temporary('install-conflict-');
  const directory = path.join(area, 'state');
  const userDir = path.join(area, '.codex');
  const result = await install(directory, { userDir });
  const configFile = path.join(userDir, 'hooks.json');
  const current = JSON.parse(await readFile(configFile, 'utf8'));
  current.hooks.Stop[0].hooks[0].timeout = 9;
  const modified = JSON.stringify(current);
  await writeFile(configFile, modified);
  assert.equal((await uninstall(directory)).status, 'conflict');
  assert.equal(await readFile(configFile, 'utf8'), modified);
  await writeFile(path.join(result.releaseRoot, 'docs', 'workflow.md'), '用户的发布副本编辑');
  assert.equal((await doctor(directory)).integrity, 'unavailable');
  await assert.rejects(install(directory, { userDir }), { code: 'INTEGRITY' });
});
test('V14 活动任务阻止首次安装/升级，明确结束后可应用', async () => {
  const f = await fixture();
  HOSTS.codex.defaultUserDir = () => path.join(f.area, '.codex');
  await start(f);
  const userDir = path.join(f.area, '.codex');
  const postponed = await install(f.directory, { userDir, sourceRoot: root });
  assert.equal(postponed.status, 'deferred');
  await assert.rejects(readFile(path.join(userDir, 'hooks.json')), { code: 'ENOENT' });
  await emit(f, { action: 'task-end' });
  assert.equal((await install(f.directory, { userDir })).status, 'installed');
  const state = await readState(f.directory);
  assert.ok(state.install.releaseRoot);
});
test('V01 doctor 指定未绑定目录时不暴露其他项目待办', async () => {
  const f = await fixture();
  await start(f);
  await createPending(f.directory, { ...await identity(f), reason: '只属于已绑定项目的知识待办' });
  const unknown = path.join(f.area, 'unbound');
  await mkdir(unknown);
  assert.equal((await doctor(f.directory, f.project)).pending.length, 1);
  assert.equal((await doctor(f.directory)).pending.length, 1);
  assert.deepEqual((await doctor(f.directory, unknown)).pending, []);
});
test('V14 全部 hook 被外部移除时保留原配置并报告冲突', async () => {
  const area = await temporary('install-removed-');
  const directory = path.join(area, 'state');
  const userDir = path.join(area, '.codex');
  await install(directory, { userDir });
  const file = path.join(userDir, 'hooks.json');
  const edited = '{"userAdded":"保留"}';
  await writeFile(file, edited);
  assert.equal((await uninstall(directory)).status, 'conflict');
  await assert.rejects(install(directory, { userDir }), { code: 'CONFLICT' });
  assert.equal(await readFile(file, 'utf8'), edited);
});
test('V14 旧版 prepared 的 after 指纹与入口一致时重装确认原事务', async () => {
  const area = await temporary('install-prepared-');
  const directory = path.join(area, 'state');
  const userDir = path.join(area, '.codex');
  await install(directory, { userDir });
  const previous = (await readState(directory)).install;
  await mutate(directory, async state => { state.install.status = 'prepared'; delete state.install.previousCurrentTarget; });
  const before = await readFile(path.join(userDir, 'hooks.json'), 'utf8');
  assert.equal((await install(directory, { userDir })).status, 'installed');
  assert.equal(await readFile(path.join(userDir, 'hooks.json'), 'utf8'), before);
  assert.equal((await readState(directory)).install.status, 'installed');
  assert.equal((await readState(directory)).install.changeId, previous.changeId);
});

async function changedSource(area) {
  const source = path.join(area, 'source');
  for (const item of RELEASE_PATHS) await fs.cp(path.join(root, item), path.join(source, item), { recursive: true });
  await fs.appendFile(path.join(source, 'README.md'), '\n事务恢复升级标记\n');
  return source;
}
async function failedRename(t, predicate, operation) {
  const original = fs.rename;
  const injected = t.mock.method(fs, 'rename', async (...args) => {
    if (predicate(...args)) throw Object.assign(new Error('模拟原子写入失败'), { code: 'EACCES' });
    return original(...args);
  });
  syncBuiltinESMExports();
  try { await operation(); }
  finally { injected.mock.restore(); syncBuiltinESMExports(); }
}

test('V14 升级意图或 prepared 状态写入失败时保留旧 current、双宿主登记与配置', async t => {
  const area = await temporary('install-intent-failure-');
  const directory = path.join(area, 'state');
  const codexDir = path.join(area, '.codex'), claudeDir = path.join(area, '.claude');
  const first = await install(directory, { userDir: codexDir });
  await install(directory, { userDir: claudeDir, agent: 'claude' });
  const sourceRoot = await changedSource(area);
  const before = await readFile(path.join(codexDir, 'hooks.json'), 'utf8');
  for (const target of ['intent', 'state']) {
    await failedRename(t, (_, to) => target === 'intent' ? path.dirname(to) === path.join(directory, 'installation-changes') : to === path.join(directory, 'state.json'), async () => {
      await assert.rejects(install(directory, { userDir: codexDir, sourceRoot }), { code: target === 'intent' ? 'EACCES' : 'STATE_WRITE_FAILED' });
    });
    assert.equal(await fs.realpath(path.join(directory, 'current')), await fs.realpath(first.releaseRoot));
    const state = await readState(directory);
    assert.equal(state.install.releaseRoot, first.releaseRoot);
    assert.equal(state.install.status, 'installed');
    assert.equal(state.installs.claude.releaseRoot, first.releaseRoot);
    assert.equal(await readFile(path.join(codexDir, 'hooks.json'), 'utf8'), before);
    assert.equal((await doctor(directory, undefined, { agent: 'claude' })).integrity, 'verified');
  }
});

test('V14 prepared 配置写失败后首次安装和升级可幂等恢复，第三种内容保留并冲突', async t => {
  for (const upgrade of [false, true]) {
    const area = await temporary('install-prepared-retry-');
    const directory = path.join(area, 'state'), userDir = path.join(area, '.codex');
    const configFile = path.join(userDir, 'hooks.json');
    await mkdir(userDir);
    const initial = '{"userAdded":"保留","hooks":{"Stop":[{"hooks":[{"type":"command","command":"other-hook"}]}]}}';
    await writeFile(configFile, initial);
    const first = upgrade ? await install(directory, { userDir }) : null;
    if (upgrade) await writeFile(configFile, JSON.stringify(JSON.parse(await readFile(configFile, 'utf8'))));
    const before = await readFile(configFile, 'utf8');
    const sourceRoot = upgrade ? await changedSource(area) : root;
    await failedRename(t, (_, to) => to === configFile, async () => {
      await assert.rejects(install(directory, { userDir, sourceRoot }), { code: 'EACCES' });
    });
    const prepared = (await readState(directory)).install;
    assert.equal(prepared.status, 'prepared');
    assert.equal(await readFile(configFile, 'utf8'), before);
    if (first) assert.equal(await fs.realpath(path.join(directory, 'current')), await fs.realpath(first.releaseRoot));
    else assert.equal(await fs.lstat(path.join(directory, 'current')).catch(() => null), null);
    // 第三种用户内容不凭 hook 结构猜测或覆盖；install/uninstall 都保留现场。
    const userEdit = '{"userAdded":"事务后用户修改"}';
    await writeFile(configFile, userEdit);
    await assert.rejects(install(directory, { userDir, sourceRoot }), { code: 'CONFLICT' });
    await assert.rejects(uninstall(directory), { code: 'CONFLICT' });
    assert.equal(await readFile(configFile, 'utf8'), userEdit);
    assert.equal((await readState(directory)).install.changeId, prepared.changeId);
    await writeFile(configFile, before);
    const result = await install(directory, { userDir, sourceRoot });
    assert.equal(result.status, 'installed');
    assert.equal(result.changeId, prepared.changeId);
    assert.equal(await fs.realpath(path.join(directory, 'current')), await fs.realpath(prepared.releaseRoot));
    assert.equal((await doctor(directory)).registration, 'registered');
    const installed = JSON.parse(await readFile(configFile, 'utf8'));
    assert.equal(installed.userAdded, '保留');
    assert.equal(installed.hooks.Stop[0].hooks[0].command, 'other-hook');
    assert.equal((await install(directory, { userDir, sourceRoot })).status, 'already-installed');
    if (first) assert.ok(await fs.lstat(first.releaseRoot));
  }
});

test('V14 after 配置与 current 已切换但确认状态写失败时安全确认或撤销', async t => {
  for (const action of ['install', 'uninstall']) {
    const area = await temporary('install-confirm-retry-');
    const directory = path.join(area, 'state'), userDir = path.join(area, '.codex');
    await install(directory, { userDir });
    const sourceRoot = await changedSource(area);
    let writes = 0;
    await failedRename(t, (_, to) => to === path.join(directory, 'state.json') && ++writes === 2, async () => {
      await assert.rejects(install(directory, { userDir, sourceRoot }), { code: 'STATE_WRITE_FAILED' });
    });
    const prepared = (await readState(directory)).install;
    assert.equal(prepared.status, 'prepared');
    assert.equal(await fs.realpath(path.join(directory, 'current')), await fs.realpath(prepared.releaseRoot));
    const after = await readFile(path.join(userDir, 'hooks.json'), 'utf8');
    const result = action === 'install' ? await install(directory, { userDir, sourceRoot }) : await uninstall(directory);
    assert.equal(result.status, action === 'install' ? 'installed' : 'uninstalled');
    if (action === 'install') {
      assert.equal(result.changeId, prepared.changeId);
      assert.equal(await readFile(path.join(userDir, 'hooks.json'), 'utf8'), after);
    } else assert.equal(JSON.parse(await readFile(path.join(userDir, 'hooks.json'), 'utf8')).hooks.Stop, undefined);
    assert.ok(await fs.lstat(prepared.releaseRoot));
  }
});

test('V14 卸载移除 hooks 后最终状态保存失败时按撤销指纹收敛，第三种内容保留', async t => {
  const area = await temporary('install-uninstall-retry-');
  const directory = path.join(area, 'state'), userDir = path.join(area, '.codex');
  await install(directory, { userDir });
  const configFile = path.join(userDir, 'hooks.json');
  let writes = 0;
  await failedRename(t, (_, to) => to === path.join(directory, 'state.json') && ++writes === 2, async () => {
    await assert.rejects(uninstall(directory), { code: 'STATE_WRITE_FAILED' });
  });
  const removed = await readFile(configFile, 'utf8');
  assert.equal(JSON.parse(removed).hooks?.Stop, undefined);
  let state = await readState(directory);
  assert.equal(state.install.status, 'installed');
  assert.ok(state.install.uninstallIntent);
  // 第三种用户内容不凭撤销意图覆盖；保留现场待核对。
  const edited = '{"userAdded":"卸载后手改"}';
  await writeFile(configFile, edited);
  await assert.rejects(uninstall(directory), { code: 'CONFLICT' });
  assert.equal(await readFile(configFile, 'utf8'), edited);
  // 配置仍为撤销意图写出的内容时，重试直接完成落盘。
  await writeFile(configFile, removed);
  assert.equal((await uninstall(directory)).status, 'uninstalled');
  state = await readState(directory);
  assert.equal(state.install.status, 'uninstalled');
  assert.equal(state.install.uninstallIntent, undefined);
  assert.equal(await readFile(configFile, 'utf8'), removed);
});

test('V14 current 切换失败与旧链接移走后中断均可按 after 指纹恢复', async t => {
  const area = await temporary('install-current-recovery-');
  const directory = path.join(area, 'state'), userDir = path.join(area, '.codex');
  const first = await install(directory, { userDir });
  const sourceRoot = await changedSource(area);
  const link = path.join(directory, 'current');
  await failedRename(t, (from, to) => to === link && path.basename(from).startsWith('.current-link-'), async () => {
    await assert.rejects(install(directory, { userDir, sourceRoot }), { code: 'EACCES' });
  });
  const prepared = (await readState(directory)).install;
  assert.equal(prepared.status, 'prepared');
  assert.equal(await fs.realpath(link), await fs.realpath(first.releaseRoot));
  // 模拟进程在把旧链接移走之后退出：aside 和发布副本都保留，不猜测清理。
  const aside = path.join(directory, '.current-old-interrupted');
  await fs.rename(link, aside);
  const result = await install(directory, { userDir, sourceRoot });
  assert.equal(result.status, 'installed');
  assert.equal(result.changeId, prepared.changeId);
  assert.equal(await fs.realpath(link), await fs.realpath(prepared.releaseRoot));
  assert.equal(await fs.realpath(aside), await fs.realpath(first.releaseRoot));
  assert.equal((await doctor(directory)).integrity, 'verified');
});

test('V14 双宿主 prepared 恢复保留原 current，其他宿主不得接管在途共享入口', async t => {
  const area = await temporary('install-shared-prepared-');
  const directory = path.join(area, 'state');
  const codexDir = path.join(area, '.codex'), claudeDir = path.join(area, '.claude');
  const first = await install(directory, { userDir: codexDir });
  await install(directory, { userDir: claudeDir, agent: 'claude' });
  const sourceRoot = await changedSource(area);
  const configFile = path.join(codexDir, 'hooks.json');
  await writeFile(configFile, JSON.stringify(JSON.parse(await readFile(configFile, 'utf8'))));
  await failedRename(t, (_, to) => to === configFile, async () => {
    await assert.rejects(install(directory, { userDir: codexDir, sourceRoot }), { code: 'EACCES' });
  });
  await assert.rejects(install(directory, { userDir: claudeDir, agent: 'claude', sourceRoot }), { code: 'RECOVERY' });
  assert.equal(await fs.realpath(path.join(directory, 'current')), await fs.realpath(first.releaseRoot));
  // 用户替换入口也不能被恢复覆盖；恢复原入口后才能继续原事务。
  const link = path.join(directory, 'current');
  await fs.unlink(link);
  await mkdir(link);
  await writeFile(path.join(link, 'user.txt'), '用户入口内容');
  await assert.rejects(install(directory, { userDir: codexDir, sourceRoot }), { code: 'CONFLICT' });
  assert.equal(await readFile(path.join(link, 'user.txt'), 'utf8'), '用户入口内容');
  await fs.rename(link, path.join(area, 'preserved-current'));
  await fs.symlink(first.releaseRoot, link, process.platform === 'win32' ? 'junction' : 'dir');
  const recovered = await install(directory, { userDir: codexDir, sourceRoot });
  assert.equal(recovered.status, 'installed');
  assert.equal((await readState(directory)).installs.claude.releaseRoot, first.releaseRoot);
  assert.equal((await install(directory, { userDir: claudeDir, agent: 'claude', sourceRoot })).status, 'installed');
  assert.equal((await doctor(directory)).integrity, 'verified');
  assert.equal((await doctor(directory, undefined, { agent: 'claude' })).integrity, 'verified');
});

test('V14 发布复制失败保留现场与用户配置，后续安装可直接重试', async t => {
  const area = await temporary('install-copy-failure-');
  const directory = path.join(area, 'state');
  const userDir = path.join(area, '.codex');
  await mkdir(userDir);
  const configFile = path.join(userDir, 'hooks.json');
  const originalConfig = '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"preserved-hook"}]}]}}';
  await writeFile(configFile, originalConfig);
  const originalCopy = fs.copyFile;
  let copiedFile, copiedContent, calls = 0;
  const injected = t.mock.method(fs, 'copyFile', async (...args) => {
    if (++calls === 2) throw Object.assign(new Error('模拟复制中途磁盘写入失败'), { code: 'ENOSPC' });
    await originalCopy(...args);
    copiedFile = args[1];
    copiedContent = await readFile(copiedFile);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(install(directory, { userDir }), { code: 'ENOSPC' });
  } finally {
    injected.mock.restore();
    syncBuiltinESMExports();
  }
  assert.equal(await readFile(configFile, 'utf8'), originalConfig);
  assert.equal((await readState(directory)).install, null);
  const retried = await install(directory, { userDir });
  assert.equal(retried.status, 'installed');
  assert.equal((await doctor(directory)).integrity, 'verified');
  assert.deepEqual(await readFile(copiedFile), copiedContent);
  const installedConfig = JSON.parse(await readFile(configFile, 'utf8'));
  assert.equal(installedConfig.hooks.Stop[0].hooks[0].command, 'preserved-hook');
});

test('V14 Claude 安装写入 settings.json 的 hooks 段，保留其他插件与顶层配置', async () => {
  const area = await temporary('install-claude-');
  HOSTS.claude.defaultUserDir = () => path.join(area, 'user', '.claude');
  const directory = path.join(area, 'state');
  const userDir = path.join(area, 'user', '.claude');
  await mkdir(userDir, { recursive: true });
  const existing = {
    env: { PRESERVED: 'yes' },
    model: 'opus',
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: 'D:/other/hook.exe', args: ['claude'], timeout: 10 }] }],
      Stop: [{ hooks: [{ type: 'command', command: 'other-stop-hook' }] }],
    },
  };
  await writeFile(path.join(userDir, 'settings.json'), JSON.stringify(existing));
  const installed = await install(directory, { userDir, agent: 'claude' });
  assert.equal(installed.status, 'installed');
  assert.equal(installed.agent, 'claude');
  const config = JSON.parse(await readFile(path.join(userDir, 'settings.json'), 'utf8'));
  assert.deepEqual(config.env, existing.env);
  assert.equal(config.model, 'opus');
  const own = config.hooks.PostToolUse[0].hooks[0];
  assert.equal(own.command, process.execPath.replaceAll('\\', '/'));
  assert.ok(own.args[0].endsWith('bin/workflow.mjs'));
  assert.deepEqual(own.args.slice(1, 5), ['hook', '--agent', 'claude', '--state-dir']);
  assert.equal(config.hooks.SessionStart[0].hooks[0].command, 'D:/other/hook.exe');
  assert.deepEqual(config.hooks.PreToolUse[0].hooks[0].args.slice(1, 3), ['hook', '--agent']);
  assert.deepEqual(config.hooks.Stop.map(group => group.hooks[0].command), ['other-stop-hook', own.command]);
  const info = await doctor(directory, undefined, { agent: 'claude' });
  assert.equal(info.agent, 'claude');
  assert.equal(info.registration, 'registered');
  assert.equal(info.integrity, 'verified');
  assert.equal((await uninstall(directory, { agent: 'claude' })).status, 'uninstalled');
  const restored = JSON.parse(await readFile(path.join(userDir, 'settings.json'), 'utf8'));
  assert.equal(restored.hooks.SessionStart.length, 1);
  assert.equal(restored.hooks.SessionStart[0].hooks[0].command, 'D:/other/hook.exe');
  assert.equal(restored.hooks.Stop.length, 1);
  assert.equal(restored.hooks.PostToolUse, undefined);
  assert.equal(restored.hooks.PreToolUse, undefined);
  assert.deepEqual(restored.env, existing.env);
});
test('V14 Claude 安装把子代理定义写入用户级 agents，升级更新，卸载只移除自有定义', async () => {
  const area = await temporary('install-agents-');
  const directory = path.join(area, 'state');
  const userDir = path.join(area, '.claude');
  const agentDir = path.join(userDir, 'agents');
  assert.equal((await install(directory, { userDir, agent: 'claude' })).status, 'installed');
  const explorer = await readFile(path.join(agentDir, 'workflow-explorer.md'), 'utf8');
  const advisor = await readFile(path.join(agentDir, 'workflow-advisor.md'), 'utf8');
  assert.match(explorer, /^model: \S+/m);
  assert.match(explorer, /^effort: \S+/m);
  assert.match(explorer, /^tools: Read, Grep, Glob$/m);
  assert.match(advisor, /^model: \S+/m);
  assert.match(advisor, /^effort: \S+/m);
  // 顾问的读取由探索者承担，但定义仍保留只读工具，不能靠删除 tools 继承全部工具。
  assert.match(advisor, /^tools: Read, Grep, Glob$/m);
  await writeFile(path.join(agentDir, 'user-own.md'), '用户自己的定义');
  const source = path.join(area, 'source');
  for (const item of RELEASE_PATHS) await fs.cp(path.join(root, item), path.join(source, item), { recursive: true });
  await fs.appendFile(path.join(source, 'agents', 'workflow-explorer.md'), '\n升级标记\n');
  assert.equal((await install(directory, { userDir, agent: 'claude', sourceRoot: source })).status, 'installed');
  assert.match(await readFile(path.join(agentDir, 'workflow-explorer.md'), 'utf8'), /升级标记/);
  assert.equal((await uninstall(directory, { userDir, agent: 'claude' })).status, 'uninstalled');
  await assert.rejects(readFile(path.join(agentDir, 'workflow-explorer.md')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(agentDir, 'workflow-advisor.md')), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(agentDir, 'user-own.md'), 'utf8'), '用户自己的定义');
});
test('V14 Claude 同名第三方与手改定义归用户，升级卸载不报冲突', async () => {
  const area = await temporary('install-agents-conflict-');
  const directory = path.join(area, 'state');
  const userDir = path.join(area, '.claude');
  const agentDir = path.join(userDir, 'agents');
  const settings = path.join(userDir, 'settings.json');
  const userFile = path.join(agentDir, 'workflow-explorer.md');
  const advisorFile = path.join(agentDir, 'workflow-advisor.md');
  await mkdir(agentDir, { recursive: true });
  await writeFile(userFile, '用户自己的定义');
  await writeFile(settings, JSON.stringify({ env: { KEEP: 'yes' } }));
  const installed = await install(directory, { userDir, agent: 'claude' });
  assert.equal(installed.status, 'installed');
  assert.equal(await readFile(userFile, 'utf8'), '用户自己的定义');
  assert.deepEqual(JSON.parse(await readFile(settings, 'utf8')).env, { KEEP: 'yes' });
  assert.match(await readFile(advisorFile, 'utf8'), /name: workflow-advisor/);
  const entries = Object.fromEntries(installed.agents.entries.map(item => [item.name, item.status]));
  assert.equal(entries['workflow-explorer.md'], 'user');
  assert.equal(entries['workflow-advisor.md'], 'managed');
  assert.ok(installed.agents.notes.some(note => note.includes('未安装默认定义')));
  const listed = await doctor(directory, undefined, { agent: 'claude' });
  const explorerDoctor = listed.agents.find(item => item.name === 'workflow-explorer.md');
  const advisorDoctor = listed.agents.find(item => item.name === 'workflow-advisor.md');
  assert.equal(explorerDoctor.status, 'user');
  assert.equal(explorerDoctor.differsFromRelease, true);
  assert.equal(advisorDoctor.status, 'managed');
  assert.equal(advisorDoctor.differsFromRelease, false);
  // 手改已安装定义后升级：内容保留、归用户，hooks 配置照常更新且不报冲突。
  await writeFile(advisorFile, '用户改写');
  const source = path.join(area, 'source');
  for (const item of RELEASE_PATHS) await fs.cp(path.join(root, item), path.join(source, item), { recursive: true });
  await fs.appendFile(path.join(source, 'agents', 'workflow-advisor.md'), '\n发布更新\n');
  const upgrade = await install(directory, { userDir, agent: 'claude', sourceRoot: source });
  assert.equal(upgrade.status, 'installed');
  assert.equal(await readFile(userFile, 'utf8'), '用户自己的定义');
  assert.equal(await readFile(advisorFile, 'utf8'), '用户改写');
  const upgradedEntries = Object.fromEntries(upgrade.agents.entries.map(item => [item.name, item.status]));
  assert.deepEqual(upgradedEntries, { 'workflow-advisor.md': 'user', 'workflow-explorer.md': 'user' });
  // 卸载保留两个用户文件并在回执列出，不失败。
  const removed = await uninstall(directory, { userDir, agent: 'claude' });
  assert.equal(removed.status, 'uninstalled');
  assert.deepEqual(removed.agents.removed, []);
  assert.deepEqual(removed.agents.kept.map(item => item.name).sort(), ['workflow-advisor.md', 'workflow-explorer.md']);
  assert.equal(await readFile(userFile, 'utf8'), '用户自己的定义');
  assert.equal(await readFile(advisorFile, 'utf8'), '用户改写');
  assert.equal((await doctor(directory, undefined, { agent: 'claude' })).registration, 'not-installed');
});
test('V14 Claude 删除的子代理定义不被补回，手动复制后按用户文件保留', async () => {
  const area = await temporary('install-agents-repair-');
  const directory = path.join(area, 'state');
  const userDir = path.join(area, '.claude');
  const agentFile = path.join(userDir, 'agents', 'workflow-advisor.md');
  await install(directory, { userDir, agent: 'claude' });
  await fs.unlink(agentFile);
  assert.equal((await install(directory, { userDir, agent: 'claude' })).status, 'already-installed');
  await assert.rejects(readFile(agentFile), { code: 'ENOENT' });
  const deleted = (await readState(directory)).installs.claude.agentLedger.find(item => item.name === 'workflow-advisor.md');
  assert.equal(deleted.status, 'deleted');
  assert.equal((await doctor(directory, undefined, { agent: 'claude' })).agents.find(item => item.name === 'workflow-advisor.md').status, 'deleted');
  // 再次安装仍不补回。
  assert.equal((await install(directory, { userDir, agent: 'claude' })).status, 'already-installed');
  await assert.rejects(readFile(agentFile), { code: 'ENOENT' });
  // 用户手动从当前发布副本复制后转 user，安装不再改写，卸载保留。
  await fs.copyFile(path.join(directory, 'current', 'agents', 'workflow-advisor.md'), agentFile);
  assert.equal((await install(directory, { userDir, agent: 'claude' })).status, 'already-installed');
  const restored = (await readState(directory)).installs.claude.agentLedger.find(item => item.name === 'workflow-advisor.md');
  assert.equal(restored.status, 'user');
  assert.equal((await doctor(directory, undefined, { agent: 'claude' })).agents.find(item => item.name === 'workflow-advisor.md').status, 'user');
  const removed = await uninstall(directory, { userDir, agent: 'claude' });
  assert.equal(removed.status, 'uninstalled');
  assert.ok(removed.agents.kept.some(item => item.name === 'workflow-advisor.md'));
  assert.match(await readFile(agentFile, 'utf8'), /name: workflow-advisor/);
});
test('V14 Claude 预置的发布同内容定义按 managed 接管，旧记录迁移后随发布更新', async () => {
  const area = await temporary('install-agents-legacy-');
  const directory = path.join(area, 'state');
  const userDir = path.join(area, '.claude');
  const agentDir = path.join(userDir, 'agents');
  const advisorFile = path.join(agentDir, 'workflow-advisor.md');
  const explorerFile = path.join(agentDir, 'workflow-explorer.md');
  await mkdir(agentDir, { recursive: true });
  await fs.copyFile(path.join(root, 'agents', 'workflow-advisor.md'), advisorFile);
  const installed = await install(directory, { userDir, agent: 'claude' });
  assert.equal(installed.status, 'installed');
  const entries = Object.fromEntries(installed.agents.entries.map(item => [item.name, item.status]));
  assert.deepEqual(entries, { 'workflow-advisor.md': 'managed', 'workflow-explorer.md': 'managed' });
  assert.ok(!installed.agents.notes.some(note => note.includes('未安装默认定义')));
  // 旧版记录只有 agentFiles/previousAgentFiles：迁移成 managed，并在升级时继续跟随发布。
  await mutate(directory, async state => {
    const record = state.installs.claude;
    const agentFiles = record.files.filter(file => file.path.startsWith('agents/')).map(file => ({ name: path.posix.basename(file.path), hash: file.hash }));
    record.agentFiles = agentFiles;
    record.previousAgentFiles = agentFiles;
    delete record.agentLedger;
  });
  const source = path.join(area, 'source');
  for (const item of RELEASE_PATHS) await fs.cp(path.join(root, item), path.join(source, item), { recursive: true });
  await fs.appendFile(path.join(source, 'agents', 'workflow-advisor.md'), '\n迁移升级标记\n');
  assert.equal((await install(directory, { userDir, agent: 'claude', sourceRoot: source })).status, 'installed');
  assert.match(await readFile(advisorFile, 'utf8'), /迁移升级标记/);
  assert.match(await readFile(explorerFile, 'utf8'), /name: workflow-explorer/);
  const upgraded = (await readState(directory)).installs.claude.agentLedger.find(item => item.name === 'workflow-advisor.md');
  assert.equal(upgraded.status, 'managed');
  // 升级中断：agentFiles 记的是未写成的新内容，文件仍是 previousAgentFiles 的内容；重试按旧 hash 认作自有并写入新发布。
  const before = await readFile(advisorFile, 'utf8');
  const beforeExplorer = await readFile(explorerFile, 'utf8');
  await mutate(directory, async state => {
    const record = state.installs.claude;
    record.agentFiles = [
      { name: 'workflow-advisor.md', hash: '未写成的新内容' },
      { name: 'workflow-explorer.md', hash: '未写成的新内容' },
    ];
    record.previousAgentFiles = [
      { name: 'workflow-advisor.md', hash: digest(before) },
      { name: 'workflow-explorer.md', hash: digest(beforeExplorer) },
    ];
    delete record.agentLedger;
  });
  const source2 = path.join(area, 'source-2');
  for (const item of RELEASE_PATHS) await fs.cp(path.join(root, item), path.join(source2, item), { recursive: true });
  await fs.appendFile(path.join(source2, 'agents', 'workflow-advisor.md'), '\n中断恢复标记\n');
  assert.equal((await install(directory, { userDir, agent: 'claude', sourceRoot: source2 })).status, 'installed');
  assert.match(await readFile(advisorFile, 'utf8'), /中断恢复标记/);
  const recovered = (await readState(directory)).installs.claude.agentLedger.find(item => item.name === 'workflow-advisor.md');
  assert.equal(recovered.status, 'managed');
});
test('V14 子代理中断重试：发布内容已写入而账本未更新时仍认作 managed', async t => {
  const area = await temporary('install-agents-retry-');
  const directory = path.join(area, 'state');
  const userDir = path.join(area, '.claude');
  const agentFile = path.join(userDir, 'agents', 'workflow-advisor.md');
  await install(directory, { userDir, agent: 'claude' });
  const source = path.join(area, 'source');
  for (const item of RELEASE_PATHS) await fs.cp(path.join(root, item), path.join(source, item), { recursive: true });
  await fs.appendFile(path.join(source, 'agents', 'workflow-advisor.md'), '\n中断重试标记\n');
  let writes = 0;
  await failedRename(t, (_, to) => to === path.join(directory, 'state.json') && ++writes === 2, async () => {
    await assert.rejects(install(directory, { userDir, agent: 'claude', sourceRoot: source }), { code: 'STATE_WRITE_FAILED' });
  });
  // 文件已是本次发布内容，但状态仍停在 prepared，账本 hash 还是上一次安装值。
  assert.match(await readFile(agentFile, 'utf8'), /中断重试标记/);
  const prepared = (await readState(directory)).installs.claude;
  assert.equal(prepared.status, 'prepared');
  const previousHash = prepared.agentLedger.find(item => item.name === 'workflow-advisor.md').hash;
  const releaseHash = digest(await readFile(path.join(source, 'agents', 'workflow-advisor.md')));
  assert.notEqual(previousHash, releaseHash);
  // 直接 doctor：内容等于发布即 managed，且只读不写账本。
  const before = await readState(directory);
  const listed = await doctor(directory, undefined, { agent: 'claude' });
  assert.equal(listed.agents.find(item => item.name === 'workflow-advisor.md').status, 'managed');
  const after = await readState(directory);
  assert.equal(after.revision, before.revision);
  assert.equal(after.installs.claude.agentLedger.find(item => item.name === 'workflow-advisor.md').hash, previousHash);
  // 重试完成后账本跟到本次发布，不转成 user。
  const retried = await install(directory, { userDir, agent: 'claude', sourceRoot: source });
  assert.equal(retried.status, 'installed');
  const ledger = (await readState(directory)).installs.claude.agentLedger.find(item => item.name === 'workflow-advisor.md');
  assert.equal(ledger.status, 'managed');
  assert.equal(ledger.hash, releaseHash);
});
test('V14 doctor 直接判定手改或非普通文件的 managed 定义，不写账本', async () => {
  const area = await temporary('install-agents-doctor-');
  const directory = path.join(area, 'state');
  const userDir = path.join(area, '.claude');
  const agentFile = path.join(userDir, 'agents', 'workflow-advisor.md');
  await install(directory, { userDir, agent: 'claude' });
  const ledgerEntry = async () => (await readState(directory)).installs.claude.agentLedger.find(item => item.name === 'workflow-advisor.md');
  // 手改后不重装，doctor 直接报 user；账本保持 managed 且修订号不变。
  await writeFile(agentFile, '用户手改');
  const before = await readState(directory);
  const modified = (await doctor(directory, undefined, { agent: 'claude' })).agents.find(item => item.name === 'workflow-advisor.md');
  assert.equal(modified.status, 'user');
  assert.equal(modified.differsFromRelease, true);
  const after = await readState(directory);
  assert.equal(after.revision, before.revision);
  assert.equal((await ledgerEntry()).status, 'managed');
  // managed 项变成非普通文件时同样报 user。
  await fs.rename(agentFile, path.join(area, 'advisor-file.md'));
  await mkdir(agentFile);
  const other = (await doctor(directory, undefined, { agent: 'claude' })).agents.find(item => item.name === 'workflow-advisor.md');
  assert.equal(other.status, 'user');
  assert.equal(other.differsFromRelease, false);
  // 文件内容等于发布而账本 hash 过期（中断重试）时仍报 managed。
  await fs.rename(agentFile, path.join(area, 'advisor-directory'));
  await fs.copyFile(path.join(root, 'agents', 'workflow-advisor.md'), agentFile);
  await mutate(directory, async state => {
    state.installs.claude.agentLedger.find(item => item.name === 'workflow-advisor.md').hash = '过期的账本内容';
  });
  const recovered = (await doctor(directory, undefined, { agent: 'claude' })).agents.find(item => item.name === 'workflow-advisor.md');
  assert.equal(recovered.status, 'managed');
  assert.equal(recovered.differsFromRelease, false);
});
test('V14 doctor 对账本为 user 的定义在文件缺失时判 deleted', async () => {
  const area = await temporary('install-agents-doctor-user-');
  const directory = path.join(area, 'state');
  const userDir = path.join(area, '.claude');
  const agentFile = path.join(userDir, 'agents', 'workflow-advisor.md');
  const entry = async () => (await readState(directory)).installs.claude.agentLedger.find(item => item.name === 'workflow-advisor.md');
  await install(directory, { userDir, agent: 'claude' });
  // 手改后重装转 user，再删除文件：安装计划与 doctor 同口径记 deleted。
  await writeFile(agentFile, '用户手改');
  await install(directory, { userDir, agent: 'claude' });
  assert.equal((await entry()).status, 'user');
  await fs.rename(agentFile, path.join(area, 'advisor-file.md'));
  assert.equal((await doctor(directory, undefined, { agent: 'claude' })).agents.find(item => item.name === 'workflow-advisor.md').status, 'deleted');
  // 安装同样不补回，账本转 deleted。
  await install(directory, { userDir, agent: 'claude' });
  assert.equal((await entry()).status, 'deleted');
  await assert.rejects(readFile(agentFile), { code: 'ENOENT' });
});
test('V14 退役定义按状态对账：managed 被改或 deleted 重新出现都归用户', async () => {
  const area = await temporary('install-agents-retired-');
  const directory = path.join(area, 'state');
  const userDir = path.join(area, '.claude');
  const source = path.join(area, 'source');
  const release = path.join(area, 'release');
  for (const item of RELEASE_PATHS) await fs.cp(path.join(root, item), path.join(source, item), { recursive: true });
  await writeFile(path.join(source, 'agents', 'legacy-agent.md'), '---\nname: legacy-agent\ntools: Read\n---\n');
  await writeFile(path.join(source, 'agents', 'legacy-gone.md'), '---\nname: legacy-gone\ntools: Read\n---\n');
  await install(directory, { userDir, agent: 'claude', sourceRoot: source });
  const target = name => path.join(userDir, 'agents', name);
  const entry = async name => (await readState(directory)).installs.claude.agentLedger.find(item => item.name === name);
  for (const name of ['legacy-agent.md', 'legacy-gone.md']) assert.equal((await entry(name)).status, 'managed', name);
  // 下一版发布不再包含这两个定义：文件仍在时保持 managed。
  for (const item of RELEASE_PATHS) await fs.cp(path.join(root, item), path.join(release, item), { recursive: true });
  await install(directory, { userDir, agent: 'claude', sourceRoot: release });
  assert.equal((await entry('legacy-agent.md')).status, 'managed');
  assert.equal((await entry('legacy-gone.md')).status, 'managed');
  // 退役 managed 被改：安装与 doctor 都归用户。
  await writeFile(target('legacy-agent.md'), '用户手改退役定义');
  await install(directory, { userDir, agent: 'claude', sourceRoot: release });
  assert.equal((await entry('legacy-agent.md')).status, 'user');
  assert.equal((await doctor(directory, undefined, { agent: 'claude' })).agents.find(item => item.name === 'legacy-agent.md').status, 'user');
  // 退役定义被删记 deleted，重新出现按用户文件保留。
  await fs.rename(target('legacy-gone.md'), path.join(area, 'legacy-gone.md'));
  await install(directory, { userDir, agent: 'claude', sourceRoot: release });
  assert.equal((await entry('legacy-gone.md')).status, 'deleted');
  await fs.copyFile(path.join(area, 'legacy-gone.md'), target('legacy-gone.md'));
  await install(directory, { userDir, agent: 'claude', sourceRoot: release });
  assert.equal((await entry('legacy-gone.md')).status, 'user');
  assert.equal((await doctor(directory, undefined, { agent: 'claude' })).agents.find(item => item.name === 'legacy-gone.md').status, 'user');
});
test('V14 Codex 安装不写用户 agents 目录', async () => {
  const area = await temporary('install-agents-codex-');
  const directory = path.join(area, 'state');
  const userDir = path.join(area, '.codex');
  assert.equal((await install(directory, { userDir })).status, 'installed');
  await assert.rejects(fs.lstat(path.join(userDir, 'agents')), { code: 'ENOENT' });
});

test('V14 current 断链/错链只做最小修复，完好重复安装不改配置', async () => {
  const area = await temporary('install-repair-');
  const directory = path.join(area, 'state');
  const userDir = path.join(area, '.codex');
  const configFile = path.join(userDir, 'hooks.json');
  const first = await install(directory, { userDir });
  const once = await readFile(configFile, 'utf8');
  const mtime = (await fs.stat(configFile)).mtimeMs;
  const link = path.join(directory, 'current');
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  // 完好重复安装：幂等，配置内容和 mtime 都不变。
  assert.equal((await install(directory, { userDir })).status, 'already-installed');
  assert.equal(await readFile(configFile, 'utf8'), once);
  assert.equal((await fs.stat(configFile)).mtimeMs, mtime);
  // 自有入口被删除：最小修复重建 current，不重写配置。
  await fs.unlink(link);
  const recreated = await install(directory, { userDir });
  assert.equal(recreated.status, 'repaired');
  assert.equal(await fs.realpath(link), await fs.realpath(first.releaseRoot));
  assert.equal(await readFile(configFile, 'utf8'), once);
  assert.equal((await fs.stat(configFile)).mtimeMs, mtime);
  assert.equal((await doctor(directory)).integrity, 'verified');
  // 自有断链：目标在 releases/ 下但已不存在，仍按自有入口修复。
  const gone = path.join(directory, 'releases', 'gone-snapshot');
  await fs.mkdir(gone, { recursive: true });
  await fs.unlink(link);
  await fs.symlink(gone, link, linkType);
  await fs.rm(gone, { recursive: true, force: true });
  const dangling = await install(directory, { userDir });
  assert.equal(dangling.status, 'repaired');
  assert.equal(await fs.realpath(link), await fs.realpath(first.releaseRoot));
  assert.equal(await readFile(configFile, 'utf8'), once);
  // 自有错链：指向 releases/ 下另一个目录，按登记发布根改回。
  const other = path.join(directory, 'releases', 'other-snapshot');
  await fs.mkdir(other, { recursive: true });
  await fs.unlink(link);
  await fs.symlink(other, link, linkType);
  const wrong = await install(directory, { userDir });
  assert.equal(wrong.status, 'repaired');
  assert.equal(await fs.realpath(link), await fs.realpath(first.releaseRoot));
  assert.equal(await readFile(configFile, 'utf8'), once);
  assert.equal((await fs.stat(configFile)).mtimeMs, mtime);
});

test('V14 用户替换的 current 目录或外部链接保留并报告冲突', async () => {
  const area = await temporary('install-unknown-');
  const directory = path.join(area, 'state');
  const userDir = path.join(area, '.codex');
  const configFile = path.join(userDir, 'hooks.json');
  await install(directory, { userDir });
  const once = await readFile(configFile, 'utf8');
  const mtime = (await fs.stat(configFile)).mtimeMs;
  const link = path.join(directory, 'current');
  // 用户自己的普通目录：不接管，保留内容和文件。
  await fs.unlink(link);
  await fs.mkdir(link);
  await writeFile(path.join(link, 'user-note.txt'), '用户资料');
  const directoryConflict = await install(directory, { userDir });
  assert.equal(directoryConflict.status, 'conflict');
  assert.equal(directoryConflict.path, link);
  assert.equal(directoryConflict.kind, 'directory');
  assert.ok(directoryConflict.conflict);
  assert.equal(await readFile(path.join(link, 'user-note.txt'), 'utf8'), '用户资料');
  assert.equal(await readFile(configFile, 'utf8'), once);
  assert.equal((await fs.stat(configFile)).mtimeMs, mtime);
  // 指向安装目录外部的链接：不自动改指或删除。
  await fs.rm(link, { recursive: true, force: true });
  const external = path.join(area, 'user-target');
  await fs.mkdir(external);
  await fs.symlink(external, link, process.platform === 'win32' ? 'junction' : 'dir');
  const linkConflict = await install(directory, { userDir });
  assert.equal(linkConflict.status, 'conflict');
  assert.equal(linkConflict.path, link);
  assert.equal(linkConflict.kind, 'link');
  assert.equal(await fs.realpath(link), await fs.realpath(external));
  assert.equal(await readFile(configFile, 'utf8'), once);
  // 首次安装遇到用户已有的 current：同样保留并报冲突，不写宿主配置。
  const fresh = path.join(area, 'fresh-state');
  await fs.mkdir(path.join(fresh, 'current'), { recursive: true });
  await writeFile(path.join(fresh, 'current', 'user-note.txt'), '用户目录');
  const freshUserDir = path.join(area, '.codex-fresh');
  const freshConflict = await install(fresh, { userDir: freshUserDir });
  assert.equal(freshConflict.status, 'conflict');
  assert.equal(await readFile(path.join(fresh, 'current', 'user-note.txt'), 'utf8'), '用户目录');
  await assert.rejects(readFile(path.join(freshUserDir, 'hooks.json')), { code: 'ENOENT' });
});

test('V14 Codex 与 Claude 安装记录互不覆盖，可分别撤销', async () => {
  const area = await temporary('install-both-');
  const directory = path.join(area, 'state');
  const codexDir = path.join(area, '.codex');
  const claudeDir = path.join(area, '.claude');
  assert.equal((await install(directory, { userDir: codexDir })).status, 'installed');
  assert.equal((await install(directory, { userDir: claudeDir, agent: 'claude' })).status, 'installed');
  const state = await readState(directory);
  assert.equal(state.install.agent, 'codex');
  assert.equal(state.installs.codex.status, 'installed');
  assert.equal(state.installs.claude.status, 'installed');
  assert.equal((await uninstall(directory, { agent: 'claude' })).status, 'uninstalled');
  assert.equal((await doctor(directory)).registration, 'registered');
  assert.equal((await doctor(directory, undefined, { agent: 'claude' })).registration, 'not-installed');
  assert.equal((await uninstall(directory)).status, 'uninstalled');
  assert.equal((await readState(directory)).installs.claude.status, 'uninstalled');
});

test('V14 双宿主跨版本重复安装不改指另一个宿主的有效入口', async () => {
  const area = await temporary('install-cross-host-');
  const directory = path.join(area, 'state');
  const codexDir = path.join(area, '.codex');
  const claudeDir = path.join(area, '.claude');
  const sourceA = path.join(area, 'source-a');
  const sourceB = path.join(area, 'source-b');
  const copy = target => fs.cp(root, target, { recursive: true, filter: item => !item.includes('.git') && !item.includes('node_modules') });
  await copy(sourceA);
  await copy(sourceB);
  await fs.appendFile(path.join(sourceB, 'README.md'), '\n新版本标记\n');
  const codexOld = await install(directory, { userDir: codexDir, sourceRoot: sourceA });
  const claudeOld = await install(directory, { userDir: claudeDir, agent: 'claude', sourceRoot: sourceA });
  assert.equal(codexOld.releaseRoot, claudeOld.releaseRoot);
  // Codex 升级到新快照，共用入口 current 改指新版本；Claude 仍登记旧版本。
  const codexNew = await install(directory, { userDir: codexDir, sourceRoot: sourceB });
  assert.equal(codexNew.status, 'installed');
  const link = path.join(directory, 'current');
  assert.equal(await fs.realpath(link), await fs.realpath(codexNew.releaseRoot));
  const claudeConfig = path.join(claudeDir, 'settings.json');
  const once = await readFile(claudeConfig, 'utf8');
  const mtime = (await fs.stat(claudeConfig)).mtimeMs;
  // 用旧版本源码重复安装 Claude：入口属于另一个已安装宿主的有效快照，不自动改指。
  const claudeAgain = await install(directory, { userDir: claudeDir, agent: 'claude', sourceRoot: sourceA });
  assert.equal(claudeAgain.status, 'conflict', JSON.stringify(claudeAgain));
  assert.equal(claudeAgain.path, link);
  assert.equal(claudeAgain.registeredBy.agent, 'codex');
  assert.equal(claudeAgain.registeredBy.version, codexNew.version);
  assert.ok(claudeAgain.conflict.includes('统一升级'), claudeAgain.conflict);
  assert.equal(await fs.realpath(link), await fs.realpath(codexNew.releaseRoot));
  assert.equal((await doctor(directory)).integrity, 'verified');
  assert.equal(await readFile(claudeConfig, 'utf8'), once);
  assert.equal((await fs.stat(claudeConfig)).mtimeMs, mtime);
  assert.equal((await readState(directory)).installs.claude.status, 'installed');
});
test('V14 Codex 附加配置目录分别安装、逐位置 doctor、撤销只撤自身条目', async () => {
  const area = await temporary('install-extra-');
  const directory = path.join(area, 'state');
  const primaryDir = path.join(area, '.codex');
  const extraDir = path.join(area, 'Cindy', 'codex-home');
  const primaryFile = path.join(primaryDir, 'hooks.json');
  const extraFile = path.join(extraDir, 'hooks.json');
  await mkdir(extraDir, { recursive: true });
  const other = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'cindy-other-plugin' }] }] }, userAdded: { keep: true } };
  await writeFile(extraFile, JSON.stringify(other));

  assert.equal((await install(directory, { userDir: primaryDir })).status, 'installed');
  const primaryText = await readFile(primaryFile, 'utf8');
  assert.equal((await install(directory, { userDir: extraDir })).status, 'installed');

  // 两条记录同时存在：旧单条记录仍是权威记录，附加位置不能覆盖它。
  const state = await readState(directory);
  assert.equal(state.install.configFile, primaryFile);
  assert.equal(state.installs.codex.configFile, primaryFile);
  assert.equal(state.installs.codex.status, 'installed');
  const extraKeys = Object.keys(state.installs.codex.extra || {});
  assert.equal(extraKeys.length, 1);
  assert.equal(state.installs.codex.extra[extraKeys[0]].configFile, extraFile);
  assert.equal(state.installs.codex.extra[extraKeys[0]].status, 'installed');
  assert.equal(await readFile(primaryFile, 'utf8'), primaryText);
  assert.deepEqual(JSON.parse(await readFile(extraFile, 'utf8')).userAdded, other.userAdded);

  // 指定附加目录时只报告该位置。
  const extraDoctor = await doctor(directory, undefined, { userDir: extraDir });
  assert.equal(extraDoctor.location, 'extra');
  assert.equal(extraDoctor.configFile, extraFile);
  assert.equal(extraDoctor.registration, 'registered');
  assert.equal(extraDoctor.integrity, 'verified');
  assert.equal(extraDoctor.locations, undefined);

  // 无参数 doctor 顶层报告默认位置，并列出所有已登记位置。
  const all = await doctor(directory);
  assert.equal(all.configFile, undefined);
  assert.equal(all.registration, 'registered');
  assert.equal(all.locations.length, 2);
  const byLocation = Object.fromEntries(all.locations.map(item => [item.location, item]));
  assert.equal(byLocation.primary.configFile, primaryFile);
  assert.equal(byLocation.primary.registration, 'registered');
  assert.equal(byLocation.extra.configFile, extraFile);
  assert.equal(byLocation.extra.registration, 'registered');
  assert.equal(byLocation.extra.integrity, 'verified');

  // 撤销附加位置只移除该位置的 workflow 条目，保留其他插件、用户配置和默认位置。
  assert.equal((await uninstall(directory, { userDir: extraDir })).status, 'uninstalled');
  const restored = JSON.parse(await readFile(extraFile, 'utf8'));
  assert.deepEqual(restored.hooks.Stop.map(group => group.hooks[0].command), ['cindy-other-plugin']);
  assert.deepEqual(restored.userAdded, other.userAdded);
  assert.equal(await readFile(primaryFile, 'utf8'), primaryText);
  assert.equal((await doctor(directory)).registration, 'registered');
  assert.equal((await doctor(directory, undefined, { userDir: extraDir })).registration, 'not-installed');
  const after = await readState(directory);
  assert.equal(after.install.configFile, primaryFile);
  assert.equal(after.installs.codex.extra[extraKeys[0]].status, 'uninstalled');
  // 附加位置可以重新安装。
  assert.equal((await install(directory, { userDir: extraDir })).status, 'installed');
  assert.equal((await doctor(directory, undefined, { userDir: extraDir })).registration, 'registered');
});
test('V14 只有附加位置时无参数 doctor/uninstall 报默认未装并保留附加位置', async () => {
  const area = await temporary('install-extra-only-');
  const directory = path.join(area, 'state');
  const defaultFile = path.join(area, '.codex', 'hooks.json');
  const extraDir = path.join(area, 'Cindy', 'codex-home');
  const extraFile = path.join(extraDir, 'hooks.json');
  await mkdir(extraDir, { recursive: true });
  const other = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'cindy-other-plugin' }] }] }, userAdded: { keep: true } };
  await writeFile(extraFile, JSON.stringify(other));

  assert.equal((await install(directory, { userDir: extraDir })).status, 'installed');
  const state = await readState(directory);
  assert.equal(state.install, null);
  assert.equal(state.installs.codex.configFile, undefined);
  assert.equal(Object.keys(state.installs.codex.extra).length, 1);
  await assert.rejects(readFile(defaultFile), { code: 'ENOENT' });

  // 默认位置未安装：无参数 doctor 报 not-installed，并列出附加位置。
  const info = await doctor(directory);
  assert.equal(info.registration, 'not-installed');
  assert.equal(info.integrity, 'not-installed');
  assert.equal(info.locations.length, 1);
  assert.equal(info.locations[0].location, 'extra');
  assert.equal(info.locations[0].configFile, extraFile);
  assert.equal(info.locations[0].registration, 'registered');

  // 无参数 uninstall 不撤附加位置，结果仍列出它。
  const skipped = await uninstall(directory);
  assert.equal(skipped.status, 'not-installed');
  assert.ok(skipped.locations.some(item => item.configFile === extraFile && item.status === 'installed'));
  assert.ok(skipped.extras.some(item => item.configFile === extraFile));
  const preserved = JSON.parse(await readFile(extraFile, 'utf8'));
  assert.deepEqual(preserved.userAdded, other.userAdded);
  assert.ok(Object.values(preserved.hooks || {}).flat().flatMap(group => group.hooks).some(handler => String(handler.command || '').includes('workflow.mjs')));
  assert.equal((await doctor(directory, undefined, { userDir: extraDir })).registration, 'registered');
});
test('V14 空状态先装附加目录、后装默认目录时默认位置成为权威记录', async () => {
  const area = await temporary('install-extra-then-default-');
  const directory = path.join(area, 'state');
  const defaultDir = path.join(area, '.codex');
  const defaultFile = path.join(defaultDir, 'hooks.json');
  const extraDir = path.join(area, 'Cindy', 'codex-home');
  const extraFile = path.join(extraDir, 'hooks.json');
  await mkdir(extraDir, { recursive: true });
  await writeFile(extraFile, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'cindy-other-plugin' }] }] } }));

  assert.equal((await install(directory, { userDir: extraDir })).status, 'installed');
  assert.equal((await readState(directory)).install, null);
  assert.equal((await install(directory, { userDir: defaultDir })).status, 'installed');

  const state = await readState(directory);
  assert.equal(state.install.configFile, defaultFile);
  assert.equal(state.installs.codex.configFile, defaultFile);
  assert.equal(state.installs.codex.status, 'installed');
  const extraKeys = Object.keys(state.installs.codex.extra || {});
  assert.equal(extraKeys.length, 1);
  assert.equal(state.installs.codex.extra[extraKeys[0]].configFile, extraFile);
  assert.equal(state.installs.codex.extra[extraKeys[0]].status, 'installed');

  const all = await doctor(directory);
  assert.equal(all.registration, 'registered');
  assert.equal(all.locations.length, 2);
  const byLocation = Object.fromEntries(all.locations.map(item => [item.location, item]));
  assert.equal(byLocation.primary.configFile, defaultFile);
  assert.equal(byLocation.extra.configFile, extraFile);
  assert.equal(byLocation.extra.registration, 'registered');

  // 无参数 uninstall 只撤默认位置，结果列出仍登记的附加位置。
  const removed = await uninstall(directory);
  assert.equal(removed.status, 'uninstalled');
  assert.ok(removed.locations.some(item => item.configFile === extraFile && item.status === 'installed'));
  const after = await readState(directory);
  assert.equal(after.install.configFile, defaultFile);
  assert.equal(after.install.status, 'uninstalled');
  assert.equal(after.installs.codex.extra[extraKeys[0]].status, 'installed');
  assert.equal((await doctor(directory, undefined, { userDir: extraDir })).registration, 'registered');
});
test('V14 旧单条非默认位置记录照常 doctor/uninstall', async () => {
  const area = await temporary('install-legacy-nondefault-');
  const directory = path.join(area, 'state');
  const extraDir = path.join(area, 'Cindy', 'codex-home');
  const extraFile = path.join(extraDir, 'hooks.json');
  await mkdir(extraDir, { recursive: true });
  assert.equal((await install(directory, { userDir: extraDir })).status, 'installed');
  // 模拟旧版单条记录：任意位置都可能直接躺在 state.install，且没有 installs。
  await mutate(directory, async state => {
    const record = Object.values(state.installs.codex.extra)[0];
    state.install = record;
    delete state.installs;
  });
  const info = await doctor(directory);
  assert.equal(info.registration, 'registered');
  assert.equal(info.locations.length, 1);
  assert.equal(info.locations[0].location, 'primary');
  assert.equal(info.locations[0].configFile, extraFile);
  assert.equal((await uninstall(directory)).status, 'uninstalled');
  assert.equal((await doctor(directory)).registration, 'not-installed');
});
test('V14 只有旧单条安装记录的状态文件照常 doctor/uninstall', async () => {
  const area = await temporary('install-legacy-');
  const directory = path.join(area, 'state');
  const userDir = path.join(area, '.codex');
  const configFile = path.join(userDir, 'hooks.json');
  assert.equal((await install(directory, { userDir })).status, 'installed');
  await mutate(directory, async state => { delete state.installs; });
  assert.equal((await readState(directory)).installs, undefined);
  const info = await doctor(directory);
  assert.equal(info.registration, 'registered');
  assert.equal(info.integrity, 'verified');
  assert.equal(info.locations.length, 1);
  assert.equal(info.locations[0].location, 'primary');
  assert.equal(info.locations[0].configFile, configFile);
  assert.equal((await uninstall(directory)).status, 'uninstalled');
  assert.equal((await doctor(directory)).registration, 'not-installed');
  assert.equal((await uninstall(directory)).status, 'not-installed');
});
test('V14 同一 Codex 配置目录不同分隔符或大小写不产生两条记录', async () => {
  const area = await temporary('install-normalize-');
  const directory = path.join(area, 'state');
  const primaryDir = path.join(area, '.codex');
  const extraDir = path.join(area, 'Cindy', 'codex-home');
  await install(directory, { userDir: primaryDir });
  await install(directory, { userDir: extraDir });
  const slash = extraDir.replaceAll('\\', '/');
  assert.equal((await install(directory, { userDir: slash })).status, 'already-installed');
  if (process.platform === 'win32') {
    assert.equal((await install(directory, { userDir: extraDir.toUpperCase() })).status, 'already-installed');
  }
  const state = await readState(directory);
  assert.equal(Object.keys(state.installs.codex.extra).length, 1);
  assert.equal((await uninstall(directory, { userDir: slash })).status, 'uninstalled');
  const after = await readState(directory);
  assert.equal(Object.keys(after.installs.codex.extra).length, 1);
  assert.equal(after.installs.codex.extra[Object.keys(after.installs.codex.extra)[0]].status, 'uninstalled');
  assert.equal(after.install.status, 'installed');
});
