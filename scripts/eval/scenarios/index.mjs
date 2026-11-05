import { E10 } from './context/e10.mjs';
import { E11 } from './context/e11.mjs';
import { E12 } from './context/e12.mjs';
import { E13 } from './context/e13.mjs';
import { E14 } from './context/e14.mjs';
import { E15 } from './context/e15.mjs';
import { E09 } from './herdr/e09.mjs';
import { E07 } from './model/e07.mjs';
import { E08 } from './model/e08.mjs';
import { E01 } from './protocol/e01.mjs';
import { E02 } from './protocol/e02.mjs';
import { E03 } from './protocol/e03.mjs';
import { E04 } from './protocol/e04.mjs';
import { E05 } from './protocol/e05.mjs';
import { E06 } from './protocol/e06.mjs';
import { E00 } from './smoke/e00.mjs';

export const SCENARIOS = [E00, E01, E02, E03, E04, E05, E06, E09, E07, E08, E10, E11, E12, E13, E14, E15];

function argumentError(message) {
  const error = new Error(message);
  error.code = 'ARGUMENT';
  return error;
}

export function selectScenarios({ scenario, suite }) {
  if (scenario) {
    // --scenario 支持逗号分隔的多个 ID；顺序沿用输入，便于成组运行成本场景。
    const ids = scenario.split(',').map(id => id.trim()).filter(Boolean);
    if (!ids.length) throw argumentError('--scenario 至少需要一个场景 ID');
    const seen = new Set();
    return ids.map(id => {
      if (seen.has(id)) throw argumentError(`重复场景：${id}`);
      seen.add(id);
      const match = SCENARIOS.find(item => item.id === id);
      if (!match) throw argumentError(`未知场景：${id}；已实现 ${SCENARIOS.map(item => item.id).join(', ')}`);
      return match;
    });
  }
  const matches = SCENARIOS.filter(item => item.suite === suite);
  if (matches.length) return matches;
  throw argumentError(`套件 ${suite} 还没有已实现的场景；已实现 ${SCENARIOS.map(item => item.id).join(', ')}`);
}
