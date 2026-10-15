// Is the local model set up properly?   npm run check:ollama [-- --model qwen3:8b --url http://localhost:11434]
// Defaults come from Settings' defaults (WEBS_LLM_MODEL / WEBS_LLM_BASE_URL if set).

import { checkOllama, exitCode } from '../src/backend/ollamaCheck';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const baseUrl = flag('url', process.env.WEBS_LLM_BASE_URL?.trim() || 'http://localhost:11434');
const model = flag('model', process.env.WEBS_LLM_MODEL?.trim() || 'qwen3:8b');

console.log(`Checking ${model} at ${baseUrl}\n`);
const mark = { pass: '✓', warn: '!', fail: '✗' } as const;
const steps = await checkOllama({ baseUrl, model });
for (const s of steps) console.log(`${mark[s.status]} ${s.name}${s.ms !== undefined ? `  (${s.ms} ms)` : ''}\n    ${s.detail}`);
const bad = steps.filter(s => s.status !== 'pass').length;
console.log(`\n${bad === 0 ? 'All good.' : exitCode(steps) ? 'Something needs fixing (see ✗ above).' : 'Works, with notes (see ! above).'}`);
process.exit(exitCode(steps));
