import { useEffect, useState } from 'react';
import type { UpdateCheckResult, UpdateState } from '../types/ipc';

export function useUpdateState(): UpdateState {
  const [state, setState] = useState<UpdateState>({ kind: 'idle' });
  useEffect(() => window.webs.onUpdateState(setState), []);
  return state;
}

/** A small notice, on every screen, when a newer version is out. One click installs it and restarts. */
export function UpdateBanner() {
  const state = useUpdateState();
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (state.kind === 'idle' || (state.kind === 'available' && dismissed === state.version)) return null;

  return (
    <div className="update-banner" role="status">
      {state.kind === 'available' && (
        <>
          <span><strong>Webs {state.version}</strong> is available.</span>
          {state.canInstall
            ? <button onClick={() => void window.webs.installUpdate()}>Install &amp; restart</button>
            : <><span className="meta">{state.whyNot}</span><button onClick={() => void window.webs.openReleasePage()}>Download</button></>}
          <button className="secondary" onClick={() => setDismissed(state.version)}>Later</button>
        </>
      )}
      {state.kind === 'downloading' && <span>Downloading Webs {state.version}… {state.percent}%</span>}
      {state.kind === 'installing' && <span>Installing Webs {state.version} — it will restart in a moment…</span>}
      {state.kind === 'error' && (
        <>
          <span className="error">Update failed: {state.message}</span>
          {state.pageUrl && <button onClick={() => void window.webs.openReleasePage()}>Download it instead</button>}
        </>
      )}
    </div>
  );
}

/** Version, "Check for updates", and the install button, for the Settings screen. */
export function UpdatesPanel() {
  const state = useUpdateState();
  const [version, setVersion] = useState('');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  useEffect(() => { void window.webs.getVersion().then(setVersion); }, []);

  async function check() {
    setChecking(true);
    setResult(null);
    setResult(await window.webs.checkForUpdates());
    setChecking(false);
  }

  const available = state.kind === 'available' ? state : null;
  return (
    <fieldset>
      <legend>Updates</legend>
      <div className="hint">
        Webs {version}
        {' '}<button type="button" className="link" onClick={check} disabled={checking || state.kind === 'downloading' || state.kind === 'installing'}>{checking ? 'Checking…' : 'Check for updates'}</button>
      </div>
      {!checking && result?.status === 'current' && <div className="hint" role="status">{result.message ?? "You're up to date."}</div>}
      {!checking && result?.status === 'error' && <div className="hint status-down" role="alert">Couldn't check: {result.message}</div>}
      {available && (
        <div className="hint" role="status">
          Version {available.version} is available.{' '}
          {available.canInstall
            ? <button type="button" className="link" onClick={() => void window.webs.installUpdate()}>Install &amp; restart</button>
            : <>{available.whyNot} <button type="button" className="link" onClick={() => void window.webs.openReleasePage()}>Download</button></>}
        </div>
      )}
      <div className="hint">Webs checks GitHub for new versions on launch; nothing else leaves your machine.</div>
    </fieldset>
  );
}
