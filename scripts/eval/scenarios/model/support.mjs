import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// 模型场景只需要一个已知文件；E08 让探索者读它，E07 让顾问在需要时补证。
export async function writeModelFixture(project) {
  await mkdir(project, { recursive: true });
  await writeFile(
    path.join(project, 'README.md'),
    '# 评测项目\n\n这个项目只有一个文件，用来验证子代理的真实调用与只读摘要。\n',
    'utf8',
  );
}
