import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, hookRegistration } from '../../assertions.mjs';
import { readJson, runCommand } from '../../isolation.mjs';

const repo = path.resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
const samePath = (left, right) => Boolean(left && right) && path.resolve(left).replaceAll('\\', '/').toLowerCase() === path.resolve(right).replaceAll('\\', '/').toLowerCase();

// 无模型安装冒烟：隔离 --user-dir/--state-dir 执行真实 install/uninstall，只读写临时目录。
export const E06 = {
  id: 'E06',
  title: '安装冒烟：隔离 user-dir 的 hook 指向临时 state-dir，卸载后恢复原 settings',
  suite: 'protocol',
  runs: 1,
  local: true,
  async prepare() {},
  async evaluate({ configDir, stateDir }) {
    const cli = path.join(repo, 'bin', 'workflow.mjs');
    const settingsPath = path.join(configDir, 'settings.json');
    const initial = { permissions: { allow: ['Read'] }, env: { WORKFLOW_EVAL_MARKER: 'keep' } };
    await mkdir(configDir, { recursive: true });
    await writeFile(settingsPath, `${JSON.stringify(initial, null, 2)}\n`, 'utf8');

    const install = await runCommand(process.execPath, [cli, 'install', '--agent', 'claude', '--user-dir', configDir, '--state-dir', stateDir], { cwd: repo });
    const installed = settingsPath ? await readJson(settingsPath) : null;
    const registration = hookRegistration(installed);
    const installOutput = (() => { try { return JSON.parse(install.stdout); } catch { return null; } })();

    const uninstall = await runCommand(process.execPath, [cli, 'uninstall', '--agent', 'claude', '--user-dir', configDir, '--state-dir', stateDir], { cwd: repo });
    const restoredText = await readJson(settingsPath);
    const uninstallOutput = (() => { try { return JSON.parse(uninstall.stdout); } catch { return null; } })();
    // 卸载会移除自有 hook，但配置里可能留下一个空 hooks 容器；用户字段必须原样恢复。
    const normalized = { ...restoredText };
    const emptyHooks = normalized?.hooks && typeof normalized.hooks === 'object' && !Array.isArray(normalized.hooks) && Object.keys(normalized.hooks).length === 0;
    if (emptyHooks) delete normalized.hooks;
    const restored = JSON.stringify(normalized) === JSON.stringify(initial);

    return [
      check(
        'install-succeeded',
        install.code === 0 && installOutput?.status === 'installed',
        install.code === 0 && installOutput?.status === 'installed'
          ? 'install 在隔离配置目录成功登记'
          : `install 未成功：退出码 ${install.code}，输出 ${install.stdout || install.stderr}`,
        { status: 'installed' },
        { code: install.code, status: installOutput?.status ?? null },
      ),
      check(
        'install-config-isolated',
        Boolean(installOutput?.configFile) && samePath(installOutput.configFile, settingsPath),
        Boolean(installOutput?.configFile) && samePath(installOutput.configFile, settingsPath)
          ? '安装只写隔离配置目录的 settings.json'
          : `安装配置路径不在隔离目录：${installOutput?.configFile || 'missing'}`,
        settingsPath,
        installOutput?.configFile ?? null,
      ),
      check(
        'hook-state-dir-isolated',
        Boolean(registration) && samePath(registration.stateDir, stateDir),
        registration && samePath(registration.stateDir, stateDir)
          ? 'hook 参数 --state-dir 指向本次临时状态目录'
          : `hook 参数没有指向临时状态目录：${registration?.stateDir || 'missing'}`,
        stateDir,
        registration?.stateDir ?? null,
      ),
      check(
        'user-settings-preserved-after-install',
        installed?.permissions?.allow?.includes('Read') === true && installed?.env?.WORKFLOW_EVAL_MARKER === 'keep',
        '安装保留用户原有 settings 字段',
        { allow: ['Read'], env: { WORKFLOW_EVAL_MARKER: 'keep' } },
        { permissions: installed?.permissions ?? null, env: installed?.env ?? null },
      ),
      check(
        'uninstall-succeeded',
        uninstall.code === 0 && uninstallOutput?.status === 'uninstalled',
        uninstall.code === 0 && uninstallOutput?.status === 'uninstalled'
          ? 'uninstall 成功撤销隔离位置的注册'
          : `uninstall 未成功：退出码 ${uninstall.code}，输出 ${uninstall.stdout || uninstall.stderr}`,
        { status: 'uninstalled' },
        { code: uninstall.code, status: uninstallOutput?.status ?? null },
      ),
      check(
        'settings-restored-after-uninstall',
        restored,
        restored
          ? `卸载后用户 settings 与安装前一致${emptyHooks ? '（只留下空 hooks 容器）' : ''}`
          : '卸载后 settings 与安装前不一致',
        initial,
        restoredText,
      ),
      check(
        'hook-removed-after-uninstall',
        !hookRegistration(restoredText),
        !hookRegistration(restoredText) ? '卸载后不再有 workflow hook 注册' : '卸载后仍残留 workflow hook 注册',
        'absent',
        hookRegistration(restoredText)?.stateDir ?? null,
      ),
    ];
  },
};
