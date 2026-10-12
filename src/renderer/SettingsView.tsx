import { UpdatesPanel } from './Updates';
import { useEffect, useRef, useState } from 'react';
import { AI_PRESETS, type AiTestResult, type KbModuleInfo, type Settings, SettingsBundle, SettingsErrors, SettingsPatch } from '../types/settings';

type OllamaStatus = { state: 'checking' } | { state: 'ok'; models: string[] } | { state: 'down'; message: string };

function diff(draft: Settings, saved: Settings): SettingsPatch {
  const patch: Record<string, Record<string, unknown>> = {};
  for (const section of Object.keys(draft) as Array<keyof Settings>) {
    for (const key of Object.keys(draft[section])) {
      const a = (draft[section] as Record<string, unknown>)[key];
      const b = (saved[section] as Record<string, unknown>)[key];
      if (JSON.stringify(a) !== JSON.stringify(b)) (patch[section] ??= {})[key] = a;
    }
  }
  return patch as SettingsPatch;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function SettingsView({ onClose }: { onClose: () => void }) {
  const [bundle, setBundle] = useState<SettingsBundle | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [errors, setErrors] = useState<SettingsErrors>({});
  const [saved, setSaved] = useState(false);
  const [ollama, setOllama] = useState<OllamaStatus>({ state: 'checking' });
  const [modules, setModules] = useState<KbModuleInfo[]>([]);
  const [captureTest, setCaptureTest] = useState<{ ok: boolean; message: string } | 'checking' | null>(null);
  const [aiTest, setAiTest] = useState<AiTestResult | 'checking' | null>(null);
  const checkSeq = useRef(0);

  useEffect(() => {
    window.webs.getSettings().then(b => { setBundle(b); setDraft(b.settings); setModules(b.modules); });
  }, []);

  const baseUrl = useDebounced(draft?.ollama.baseUrl ?? '', 500);
  const kbDir = useDebounced(draft?.kb.dir ?? '', 400);

  function checkOllama(url: string) {
    const seq = ++checkSeq.current;
    setOllama({ state: 'checking' });
    window.webs.listOllamaModels(url).then(r => {
      if (seq !== checkSeq.current) return; // a newer check superseded this one
      setOllama(r.ok ? { state: 'ok', models: r.models } : { state: 'down', message: r.message });
    });
  }

  useEffect(() => { if (baseUrl) checkOllama(baseUrl); }, [baseUrl]);

  useEffect(() => {
    if (!kbDir || !bundle) return;
    let live = true;
    window.webs.listKbModules(kbDir).then(m => { if (live) setModules(m); });
    return () => { live = false; };
  }, [kbDir, bundle]);

  if (!draft || !bundle) return <div className="screen settings"><p className="hint">Loading…</p></div>;

  const patch = diff(draft, bundle.settings);
  const dirty = Object.keys(patch).length > 0;
  const set = <S extends keyof Settings>(section: S, key: keyof Settings[S], value: unknown) => {
    setSaved(false);
    setDraft({ ...draft, [section]: { ...draft[section], [key]: value } });
  };
  const err = (k: string) => errors[k] && <div className="field-error" role="alert">{errors[k]}</div>;

  async function save() {
    const r = await window.webs.saveSettings(patch);
    if (r.ok) { setBundle(r.bundle); setDraft(r.bundle.settings); setErrors({}); setSaved(true); }
    else { setErrors(r.errors); setSaved(false); }
  }

  async function reset() {
    if (!window.confirm('Reset all settings to their defaults?')) return;
    const b = await window.webs.resetSettings();
    setBundle(b); setDraft(b.settings); setModules(b.modules); setErrors({}); setSaved(true);
  }

  async function saveAndTestAi() {
    setAiTest('checking');
    if (dirty) {
      const r = await window.webs.saveSettings(patch);
      if (!r.ok) { setErrors(r.errors); setSaved(false); setAiTest(null); return; }
      setBundle(r.bundle); setDraft(r.bundle.settings); setErrors({}); setSaved(true);
    }
    setAiTest(await window.webs.testAi());
  }

  async function removeAiKey() {
    const b = await window.webs.clearAiKey();
    setBundle(b); setDraft({ ...draft!, ai: { ...draft!.ai, apiKey: '' } }); setAiTest(null);
  }

  function pickPreset(id: string) {
    const p = AI_PRESETS[id];
    if (!p) return;
    setSaved(false); setAiTest(null);
    setDraft({ ...draft!, ai: { ...draft!.ai, kind: p.kind, baseUrl: p.baseUrl, model: draft!.ai.model || p.model } });
  }

  async function testCapture() {
    setCaptureTest('checking');
    setCaptureTest(await window.webs.testCapture(draft!.capture.url, draft!.capture.token));
  }

  async function browse() {
    const dir = await window.webs.pickKbFolder();
    if (dir) set('kb', 'dir', dir);
  }

  function toggleModule(name: string, enabled: boolean) {
    const rest = draft!.kb.disabledModules.filter(m => m !== name);
    set('kb', 'disabledModules', enabled ? rest : [...rest, name]);
  }

  const modelInstalled = ollama.state === 'ok' ? ollama.models.includes(draft.ollama.model) : true;

  return (
    <div className="screen settings">
      <div className="bar">
        <button onClick={onClose}>← Back</button>
        <span className="q">Settings</span>
      </div>
      <div className="settings-body">
        <form onSubmit={e => { e.preventDefault(); if (dirty) void save(); }}>
          <fieldset>
            <legend>Ollama</legend>
            <label>
              Server URL
              <input value={draft.ollama.baseUrl} onChange={e => set('ollama', 'baseUrl', e.target.value)} spellCheck={false} />
            </label>
            {err('ollama.baseUrl')}
            <div className={`hint status-${ollama.state}`} aria-live="polite">
              {ollama.state === 'checking' && 'Checking…'}
              {ollama.state === 'ok' && `Connected · ${ollama.models.length} model${ollama.models.length === 1 ? '' : 's'} installed`}
              {ollama.state === 'down' && ollama.message}
              {' '}<button type="button" className="link" onClick={() => checkOllama(draft.ollama.baseUrl)}>Test connection</button>
            </div>
            <label>
              Model
              <input list="ollama-models" value={draft.ollama.model} onChange={e => set('ollama', 'model', e.target.value)} spellCheck={false} />
              <datalist id="ollama-models">{ollama.state === 'ok' && ollama.models.map(m => <option key={m} value={m} />)}</datalist>
            </label>
            {err('ollama.model')}
            {!modelInstalled && <div className="hint warn">Not installed on that server. Run <code>ollama pull {draft.ollama.model}</code>.</div>}
            <label>
              Stop waiting after (seconds of silence)
              <input type="number" min={5} max={600} value={draft.ollama.idleTimeoutSec} onChange={e => set('ollama', 'idleTimeoutSec', Number(e.target.value))} />
            </label>
            {err('ollama.idleTimeoutSec')}
          </fieldset>

          <fieldset>
            <legend>Knowledge base</legend>
            <label>
              Folder
              <span className="row">
                <input value={draft.kb.dir} onChange={e => set('kb', 'dir', e.target.value)} spellCheck={false} />
                <button type="button" onClick={browse}>Browse…</button>
                <button type="button" onClick={() => { void window.webs.revealKbFolder(); }} title="Show the saved folder in Finder">Open</button>
              </span>
            </label>
            {err('kb.dir')}
            <div className="modules" role="group" aria-label="Knowledge base modules">
              {modules.length === 0 && <div className="hint warn">No markdown (.md) files found in this folder.</div>}
              {modules.map(m => (
                <label key={m.name} className="check">
                  <input type="checkbox" checked={!draft.kb.disabledModules.includes(m.name)} onChange={e => toggleModule(m.name, e.target.checked)} />
                  {m.name} <span className="meta">{m.files} file{m.files === 1 ? '' : 's'}</span>
                </label>
              ))}
            </div>
            {err('kb.disabledModules')}
            <div className="hint">Each top-level folder is a module. Unchecked modules are skipped during search.</div>
          </fieldset>

          <fieldset>
            <legend>Generation</legend>
            <label>
              Strategy
              <select value={draft.generation.strategy} onChange={e => set('generation', 'strategy', e.target.value)}>
                {[...new Set([...bundle.strategies, draft.generation.strategy])].map(s => <option key={s}>{s}</option>)}
              </select>
            </label>
            {err('generation.strategy')}
            <div className="pair">
              <label>
                Clusters
                <input type="number" min={1} max={8} value={draft.generation.clusterCount} onChange={e => set('generation', 'clusterCount', Number(e.target.value))} />
              </label>
              <label>
                Fragments per cluster
                <input type="number" min={1} max={6} value={draft.generation.fragmentsPerCluster} onChange={e => set('generation', 'fragmentsPerCluster', Number(e.target.value))} />
              </label>
            </div>
            {err('generation.clusterCount')}
            {err('generation.fragmentsPerCluster')}
          </fieldset>

          <fieldset>
            <legend>Libraries</legend>
            <div className="hint">Big offline reference collections (Wikipedia, …). Your notes come first; when they have nothing on a topic, enabled libraries are searched next, and anything found there is marked <strong>W</strong> with a solid blue outline.</div>
            {bundle.libraries.length === 0 && <div className="hint">No libraries found in <code>{draft.library.dir || '(no folder set)'}</code>.</div>}
            {bundle.libraries.map(l => (
              <label key={l.name} className="check">
                <input type="checkbox" checked={!draft.library.disabled.includes(l.name)} onChange={e => {
                  const rest = draft.library.disabled.filter(n => n !== l.name);
                  set('library', 'disabled', e.target.checked ? rest : [...rest, l.name]);
                }} />
                {l.label} <span className="meta">{l.articles.toLocaleString()} articles · {(l.bytes / 1e9 >= 1 ? `${(l.bytes / 1e9).toFixed(1)} GB` : `${Math.round(l.bytes / 1e6)} MB`)}</span>
              </label>
            ))}
            <div className="hint">Add one with <code>npm run library:import -- &lt;dump.xml.bz2&gt;</code> (see the README); libraries are read from <code>{draft.library.dir || 'the libraries folder'}</code>.</div>
          </fieldset>

          <fieldset>
            <legend>AI provider</legend>
            <label className="check">
              <input type="checkbox" checked={draft.ai.enabled} onChange={e => set('ai', 'enabled', e.target.checked)} />
              Answer from my AI provider when my notes have nothing on a topic
            </label>
            <div className="hint">Your notes always come first. Anything the AI writes is marked <strong>✦ AI</strong> and drawn with a dashed outline, so you can tell it apart from what came from your notes. Only the topic is sent to the provider — never your notes.</div>
            <label>
              Provider
              <select value={Object.entries(AI_PRESETS).find(([, p]) => p.baseUrl === draft.ai.baseUrl && p.kind === draft.ai.kind)?.[0] ?? 'custom'} onChange={e => pickPreset(e.target.value)}>
                {Object.entries(AI_PRESETS).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}
                <option value="custom">Custom endpoint…</option>
              </select>
            </label>
            <label>
              API URL <span className="meta">{draft.ai.kind === 'anthropic' ? 'Anthropic Messages API' : 'any OpenAI-compatible chat endpoint'}</span>
              <input value={draft.ai.baseUrl} onChange={e => { setAiTest(null); set('ai', 'baseUrl', e.target.value); }} spellCheck={false} />
            </label>
            {err('ai.baseUrl')}
            <label>
              Model
              <input value={draft.ai.model} onChange={e => { setAiTest(null); set('ai', 'model', e.target.value); }} placeholder="e.g. gpt-4o-mini" spellCheck={false} />
            </label>
            <label>
              API key <span className="meta">{bundle.aiKeySet ? 'saved in your keychain — type to replace it' : 'stored in your keychain, never shown again'}</span>
              <input type="password" value={draft.ai.apiKey} onChange={e => { setAiTest(null); set('ai', 'apiKey', e.target.value); }} placeholder={bundle.aiKeySet ? '••••••••••••' : ''} autoComplete="off" spellCheck={false} />
            </label>
            <label className="check">
              <input type="checkbox" checked={draft.ai.topUp} onChange={e => set('ai', 'topUp', e.target.checked)} />
              Also fill gaps: add AI collections when my notes find fewer than {draft.generation.clusterCount}
            </label>
            <div className={`hint ${aiTest && aiTest !== 'checking' && !aiTest.ok ? 'status-down' : ''}`} aria-live="polite">
              {aiTest === 'checking' && 'Checking…'}
              {aiTest && aiTest !== 'checking' && aiTest.message}
              {' '}<button type="button" className="link" onClick={saveAndTestAi} disabled={aiTest === 'checking'}>{dirty ? 'Save & test' : 'Test connection'}</button>
              {bundle.aiKeySet && <> · <button type="button" className="link" onClick={removeAiKey}>Remove saved key</button></>}
            </div>
          </fieldset>

          <fieldset>
            <legend>Capture inbox</legend>
            <label>
              Capture service URL <span className="meta">leave empty to turn the inbox off</span>
              <input value={draft.capture.url} onChange={e => { setCaptureTest(null); set('capture', 'url', e.target.value); }} placeholder="http://localhost:8787" spellCheck={false} />
            </label>
            {err('capture.url')}
            <label>
              Token
              <input type="password" value={draft.capture.token} onChange={e => { setCaptureTest(null); set('capture', 'token', e.target.value); }} autoComplete="off" spellCheck={false} />
            </label>
            <div className={`hint ${captureTest && captureTest !== 'checking' && !captureTest.ok ? 'status-down' : ''}`} aria-live="polite">
              {captureTest === 'checking' && 'Checking…'}
              {captureTest && captureTest !== 'checking' && captureTest.message}
              {' '}<button type="button" className="link" onClick={testCapture} disabled={!draft.capture.url}>Test connection</button>
            </div>
            <div className="hint">Your webs-capture service. Captures from the browser extension (see <code>extension/</code>) and your phone appear in the canvas Inbox.</div>
          </fieldset>

          <UpdatesPanel />

          <div className="actions">
            <button type="submit" disabled={!dirty}>Save</button>
            <button type="button" className="secondary" onClick={reset}>Reset to defaults</button>
            {saved && !dirty && <span className="hint" role="status">Saved · applies to your next generation</span>}
          </div>
        </form>
      </div>
    </div>
  );
}
