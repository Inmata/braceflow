import { fail } from './store.mjs';
import { projectFor } from './learning-config.mjs';
import { readEntries, readItems, selectStandingKnowledge } from './learning.mjs';
import { readExtractionJobs } from './capture.mjs';

// 效果摘要固定为滚动窗口；默认值写死在代码里，不新增配置项。
export const DIGEST_DAYS = 7;
const DAY_MS = 86400000;
const count = (list, status) => list.filter(item => item.status === status).length;
const sum = (list, pick) => list.reduce((total, item) => total + pick(item), 0);
const rejectedOf = run => Array.isArray(run.rejected) ? run.rejected : Array.isArray(run.proposal?.rejected) ? run.proposal.rejected : [];
const unhandledOf = run => Array.isArray(run.unhandled) ? run.unhandled : Array.isArray(run.proposal?.unhandled) ? run.proposal.unhandled : [];
const inWindow = (value, start, end) => {
  const at = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(at) && at >= start && at <= end;
};

// 只读窗口摘要：复用常驻规则的 recurrence 派生，不写状态、不调用模型、不记录 shown。
export async function learningDigest(directory, root, options = {}) {
  const days = options.days === undefined ? DIGEST_DAYS : options.days;
  if (!Number.isSafeInteger(days) || days < 1 || days > 90) fail('ARGUMENT', '--days 必须是 1 到 90 的整数');
  const now = options.now === undefined ? new Date() : new Date(options.now);
  if (!Number.isFinite(now.getTime())) fail('ARGUMENT', '摘要时间无效');
  const start = now.getTime() - days * DAY_MS;
  const end = now.getTime();
  const project = await projectFor(directory, root);
  const allRuns = await readItems(directory, project, 'runs');

  const materials = (await readItems(directory, project, 'inbox')).filter(item => inWindow(item.createdAt, start, end));
  const runs = allRuns.filter(run => inWindow(run.startedAt, start, end));
  const runsReport = {
    total: runs.length,
    completed: count(runs, 'completed'),
    partial: count(runs, 'partial'),
    failed: count(runs, 'failed'),
    timeout: count(runs, 'timeout'),
    rejected: sum(runs, run => rejectedOf(run).length),
    unhandled: sum(runs, run => unhandledOf(run).length),
  };

  let entries = [], knowledgeError = null;
  try { entries = await readEntries(project); } catch (error) { knowledgeError = error.code || 'KNOWLEDGE'; }
  const history = entries.flatMap(entry => (entry.history || []).map(item => ({ ...item, knowledgeId: entry.id })));
  const standing = (await selectStandingKnowledge(directory, project.root, { project, readOnly: true }))?.selected || [];
  const knowledge = {
    available: !knowledgeError,
    created: history.filter(item => item.action === 'create' && inWindow(item.at, start, end)).length,
    revised: history.filter(item => item.action === 'revise' && inWindow(item.at, start, end)).length,
    stable: entries.filter(entry => entry.maturity === 'stable').length,
    standing: standing.map(item => ({ id: item.id, title: item.title, seen: item.seen, dates: item.dates, lastSeen: item.lastSeen })),
    ...(knowledgeError ? { error: knowledgeError } : {}),
  };

  const byIncident = new Map();
  for (const item of materials) {
    if (typeof item.incidentId !== 'string' || !item.incidentId) continue;
    const ids = byIncident.get(item.incidentId) || [];
    ids.push(item.id);
    byIncident.set(item.incidentId, ids);
  }
  const repeated = [...byIncident.entries()]
    .filter(([, ids]) => ids.length >= 2)
    .map(([incidentId, ids]) => ({ incidentId, count: ids.length, ids: ids.sort() }))
    .sort((a, b) => b.count - a.count || a.incidentId.localeCompare(b.incidentId));

  const disputed = entries.filter(entry => entry.status === 'disputed').map(entry => ({ id: entry.id, title: entry.title }));
  const counterEvidence = Object.entries(project.learning?.disputes || {})
    .map(([knowledgeId, value]) => ({
      knowledgeId,
      observationId: value?.observationId ?? null,
      reason: value?.reason ?? null,
      at: value?.at ?? null,
    }))
    .sort((a, b) => a.knowledgeId.localeCompare(b.knowledgeId));
  const conflicts = allRuns
    .filter(run => ['conflict', 'kept'].includes(run.status))
    .map(run => ({ id: run.id, status: run.status, reason: run.reason ?? null, startedAt: run.startedAt ?? null }))
    .sort((a, b) => String(a.startedAt || '').localeCompare(String(b.startedAt || '')) || a.id.localeCompare(b.id));

  const { jobs } = await readExtractionJobs(directory, project);
  const captureJobs = jobs.filter(job => inWindow(job.createdAt, start, end));
  const capture = {
    total: captureJobs.length,
    pending: count(captureJobs, 'pending'),
    running: count(captureJobs, 'running'),
    completed: count(captureJobs, 'completed'),
    skipped: count(captureJobs, 'skipped'),
    failed: count(captureJobs, 'failed'),
    timeout: count(captureJobs, 'timeout'),
    candidates: sum(captureJobs, job => Number.isSafeInteger(job.candidates) ? job.candidates : 0),
    rejected: sum(captureJobs, job => Array.isArray(job.rejected) ? job.rejected.length : 0),
  };

  const feedbackEvents = (await readItems(directory, project, 'feedback')).filter(item => inWindow(item.createdAt, start, end));
  const feedback = {
    shown: feedbackEvents.filter(item => item.outcome === 'shown').length,
    adopted: feedbackEvents.filter(item => item.outcome === 'adopted').length,
    total: feedbackEvents.length,
    note: '仅显式记录，不等于采纳或成功',
  };

  return {
    at: now.toISOString(),
    projectId: project.projectId,
    window: { start: new Date(start).toISOString(), end: now.toISOString(), days },
    materials: {
      total: materials.length,
      pending: count(materials, 'pending'),
      waiting: count(materials, 'waiting'),
      processed: count(materials, 'processed'),
    },
    runs: runsReport,
    knowledge,
    repeated,
    unresolved: { disputed, counterEvidence, conflicts },
    capture,
    feedback,
  };
}
