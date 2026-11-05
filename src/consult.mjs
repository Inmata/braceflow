import path from 'node:path';
import { atomicWrite, digest, id, readText, withLock } from './store.mjs';

export const CONSULTATION_SCHEMA = 1;
// 顾问识别与只读豁免共用 subagents 的定义解析：默认名之外，改名后的顾问以 frontmatter 声明。
export { isAdvisorSubagent } from './subagents.mjs';

const consultationKey = (projectId, sessionId) => digest(`${projectId}\0${sessionId}`);
export const consultationPath = (directory, projectId, sessionId) => path.join(directory, 'consultations', `${consultationKey(projectId, sessionId)}.json`);

// 只读；文件损坏时返回 null，由调用方决定是否提示，不覆盖原文件。
export async function readConsultations(directory, projectId, sessionId) {
  const text = await readText(consultationPath(directory, projectId, sessionId));
  if (text === null) return { schemaVersion: CONSULTATION_SCHEMA, projectId, sessionId, consultations: [] };
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!value || value.schemaVersion !== CONSULTATION_SCHEMA || value.projectId !== projectId || value.sessionId !== sessionId || !Array.isArray(value.consultations)) return null;
  return value;
}

const summary = (prompt, description) => {
  const text = typeof description === 'string' && description.trim()
    ? description.trim()
    : typeof prompt === 'string' ? prompt.trim().split(/\r?\n/)[0].trim() : '';
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
};

// 会话级咨询记录与任务状态分开存放；同一会话的并发顾问调用用独立锁串行追加，不增加 state.revision。
export async function recordConsultation(directory, { projectId, sessionId, taskId = null, turnId = null, subagentType, prompt, description, eventId = null }) {
  try {
    return await withLock(directory, 'consultations', async () => {
      const existing = await readConsultations(directory, projectId, sessionId);
      if (existing === null) return { recorded: false, reason: '咨询记录文件无法解析，保留原文件未写入' };
      if (eventId && existing.consultations.some(item => item.eventId === eventId)) return { recorded: false, replayed: true };
      const consultation = {
        consultationId: id('consultation'),
        at: new Date().toISOString(),
        taskId: taskId || null,
        turnId: turnId || null,
        subagentType,
        question: summary(prompt, description),
        ...(eventId ? { eventId } : {}),
      };
      existing.consultations.push(consultation);
      await atomicWrite(consultationPath(directory, projectId, sessionId), `${JSON.stringify(existing, null, 2)}\n`);
      return { recorded: true, consultation };
    }, { budgetMs: 800 });
  } catch (error) {
    return { recorded: false, reason: error.code === 'LOCKED' ? '咨询记录锁等待超时，未写入' : `咨询记录写入失败（${error.code || 'IO'}）` };
  }
}
