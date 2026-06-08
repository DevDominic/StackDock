import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { getErrorMessage } from '../../lib/errors';
import { DEFAULT_THEME_ID, applyTheme, getThemes, parseVsCodeThemeJson, registerThemes } from '../../lib/themeSupport';
import type { AutomationConfig, StackDockSettings, Workspace, WorkspaceSetup } from '../../shared/types';

export type SettingsTab = 'general' | 'appearance' | 'terminal' | 'workspace';

interface Props {
  settings: StackDockSettings;
  currentWorkspaceId: string;
  initialTab?: SettingsTab;
  onSave(settings: StackDockSettings): Promise<void>;
  onAutomationSaved(config: AutomationConfig): void;
  onClose(): void;
}

const GLOBAL_KEY = '__global__';
const DRAFT_CACHE_KEY = 'stackdock.automationDraft';

interface DraftCache {
  draftByKey: Record<string, string>;
  keyOrder: string[];
  selectedKey: string;
}

function workspaceTemplate(): WorkspaceSetup {
  return { defaultTerminalProfile: 'powershell', newSessionCommand: '', commands: [{ id: 'test', label: 'Run Tests', command: 'npm test' }] };
}

function isValidJson(text: string): boolean {
  try { JSON.parse(text); return true; } catch { return false; }
}

function readCache(): DraftCache | null {
  try {
    const raw = localStorage.getItem(DRAFT_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftCache;
    return parsed && parsed.draftByKey ? parsed : null;
  } catch { return null; }
}

function writeCache(cache: DraftCache) {
  try { localStorage.setItem(DRAFT_CACHE_KEY, JSON.stringify(cache)); } catch { /* ignore quota/availability */ }
}

function clearCache() {
  try { localStorage.removeItem(DRAFT_CACHE_KEY); } catch { /* ignore */ }
}

export function SettingsModal({ settings, currentWorkspaceId, initialTab, onSave, onAutomationSaved, onClose }: Props) {
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? 'general');
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);
  const valid = draft.terminalProfiles.every((profile) => profile.name.trim() && profile.shell.trim());
  const themeOptions = useMemo(() => getThemes(draft.importedThemes), [draft.importedThemes]);

  // Workspace tab (automation.json) state.
  const [wsLoading, setWsLoading] = useState(true);
  const [wsSaving, setWsSaving] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [originalKeys, setOriginalKeys] = useState<Set<string>>(new Set());
  const [draftByKey, setDraftByKey] = useState<Record<string, string>>({});
  const [keyOrder, setKeyOrder] = useState<string[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>(currentWorkspaceId);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [raw, list] = await Promise.all([api.automation.loadRaw(), api.workspaces.list()]);
        if (!active) return;
        setWorkspaces(list);
        let parsed: AutomationConfig = { commands: [], workspaces: {} };
        try { if (raw.trim()) parsed = JSON.parse(raw) as AutomationConfig; } catch { /* keep empty default */ }
        const existing = parsed.workspaces ?? {};
        setOriginalKeys(new Set(Object.keys(existing)));

        const listIds = list.map((w) => w.id);
        const orphanIds = Object.keys(existing).filter((id) => !listIds.includes(id));
        // currentWorkspaceId is empty when Settings is opened from the home screen (no active workspace).
        const hasCurrent = !!currentWorkspaceId && (listIds.includes(currentWorkspaceId) || orphanIds.includes(currentWorkspaceId));
        const ordered = [
          ...(hasCurrent ? [currentWorkspaceId] : []),
          ...listIds.filter((id) => id !== currentWorkspaceId),
          ...orphanIds.filter((id) => id !== currentWorkspaceId),
        ];

        const cached = readCache();
        const byKey: Record<string, string> = cached ? { ...cached.draftByKey } : {};
        if (byKey[GLOBAL_KEY] == null) byKey[GLOBAL_KEY] = JSON.stringify(parsed.commands ?? [], null, 2);
        ordered.forEach((id) => { if (byKey[id] == null) byKey[id] = JSON.stringify(existing[id] ?? {}, null, 2); });

        const defaultKey = hasCurrent ? currentWorkspaceId : GLOBAL_KEY;
        setDraftByKey(byKey);
        setKeyOrder(ordered);
        setSelectedKey(cached?.selectedKey && byKey[cached.selectedKey] != null ? cached.selectedKey : defaultKey);
      } catch (err) {
        if (active) setWsError(getErrorMessage(err, 'Could not load workspace config'));
      } finally {
        if (active) setWsLoading(false);
      }
    })();
    return () => { active = false; };
  }, [currentWorkspaceId]);

  function labelFor(key: string): string {
    if (key === GLOBAL_KEY) return 'Global commands';
    const ws = workspaces.find((w) => w.id === key);
    return ws ? ws.name : key;
  }

  function setSlice(key: string, value: string) {
    setDraftByKey((prev) => {
      const next = { ...prev, [key]: value };
      writeCache({ draftByKey: next, keyOrder, selectedKey });
      return next;
    });
  }

  function selectKey(key: string) {
    setSelectedKey(key);
    writeCache({ draftByKey, keyOrder, selectedKey: key });
  }

  const invalidKeys = useMemo(
    () => Object.entries(draftByKey).filter(([, text]) => !isValidJson(text)).map(([key]) => key),
    [draftByKey],
  );

  async function saveWorkspace() {
    if (invalidKeys.length) {
      setWsError(`Invalid JSON in: ${invalidKeys.map(labelFor).join(', ')}. Fix before saving.`);
      return;
    }
    setWsSaving(true);
    setWsError(null);
    try {
      const commands = JSON.parse(draftByKey[GLOBAL_KEY] ?? '[]');
      const workspacesObj: Record<string, unknown> = {};
      for (const [key, text] of Object.entries(draftByKey)) {
        if (key === GLOBAL_KEY) continue;
        const value = JSON.parse(text);
        const isEmpty = value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0;
        // Preserve existing entries; only add new workspaces if the user actually configured them.
        if (originalKeys.has(key) || !isEmpty) workspacesObj[key] = value;
      }
      const merged = { commands, workspaces: workspacesObj };
      const config = await api.automation.saveRaw(JSON.stringify(merged, null, 2));
      clearCache();
      setOriginalKeys(new Set(Object.keys(workspacesObj)));
      onAutomationSaved(config);
    } catch (err) {
      setWsError(getErrorMessage(err, 'Could not save workspace config'));
    } finally {
      setWsSaving(false);
    }
  }

  const selectedText = draftByKey[selectedKey] ?? '';
  const orderedKeys = [GLOBAL_KEY, ...keyOrder];

  async function importEditorTheme() {
    setThemeError(null);
    try {
      const file = await api.app.importJsonFile();
      if (!file) return;
      const parsed = parseVsCodeThemeJson(file.content);
      const usedIds = new Set(getThemes(draft.importedThemes).map((theme) => theme.id));
      let id = parsed.id;
      let suffix = 2;
      while (usedIds.has(id)) id = `${parsed.id}-${suffix++}`;
      const theme = { ...parsed, id };
      const importedThemes = [...draft.importedThemes, theme];
      registerThemes(importedThemes);
      applyTheme(theme.id, importedThemes);
      setDraft({ ...draft, themeId: theme.id, importedThemes });
    } catch (err) {
      setThemeError(getErrorMessage(err, 'Could not import VS Code theme'));
    }
  }

  function selectTheme(themeId: string) {
    applyTheme(themeId, draft.importedThemes);
    setDraft({ ...draft, themeId });
  }

  function removeSelectedTheme() {
    const importedThemes = draft.importedThemes.filter((theme) => theme.id !== draft.themeId);
    applyTheme(DEFAULT_THEME_ID, importedThemes);
    setDraft({ ...draft, importedThemes, themeId: DEFAULT_THEME_ID });
  }

  function closeWithoutSave() {
    applyTheme(settings.themeId, settings.importedThemes);
    onClose();
  }

  return (
    <div className="modal-backdrop" onMouseDown={closeWithoutSave}>
      <div className="modal settings-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="panel-title row"><span>Settings</span><button className="ghost" onClick={closeWithoutSave}>×</button></div>
        <div className="topbar-nav settings-tabs">
          <button className={tab === 'general' ? 'active-toggle' : ''} onClick={() => setTab('general')}>General</button>
          <button className={tab === 'appearance' ? 'active-toggle' : ''} onClick={() => setTab('appearance')}>Looks &amp; feel</button>
          <button className={tab === 'terminal' ? 'active-toggle' : ''} onClick={() => setTab('terminal')}>Terminal profiles</button>
          <button className={tab === 'workspace' ? 'active-toggle' : ''} onClick={() => setTab('workspace')}>Workspace</button>
        </div>

        {tab === 'general' ? (
          <div className="settings-tab-body">
            <label><input type="checkbox" checked={draft.confirmBeforeDiscard} onChange={(event) => setDraft({ ...draft, confirmBeforeDiscard: event.target.checked })} /> Confirm before discard</label>
            <label><input type="checkbox" checked={draft.showHiddenFiles} onChange={(event) => setDraft({ ...draft, showHiddenFiles: event.target.checked })} /> Show hidden files</label>
            <label><input type="checkbox" checked={draft.emptySessionsVisible} onChange={(event) => setDraft({ ...draft, emptySessionsVisible: event.target.checked })} /> Show empty sessions</label>
            <label><input type="checkbox" checked={draft.showSessionCwdForAll} onChange={(event) => setDraft({ ...draft, showSessionCwdForAll: event.target.checked })} /> Always show session directories</label>
            <label><input type="checkbox" checked={draft.openLinksExternally} onChange={(event) => setDraft({ ...draft, openLinksExternally: event.target.checked })} /> Open terminal links in system browser</label>
            <label><input type="checkbox" checked={draft.autoSave} onChange={(event) => setDraft({ ...draft, autoSave: event.target.checked })} /> Auto save</label>
            <label>Auto save delay (ms)<input type="number" min={200} step={100} disabled={!draft.autoSave} value={draft.autoSaveDelayMs} onChange={(event) => setDraft({ ...draft, autoSaveDelayMs: Math.max(200, Number(event.target.value) || 0) })} /></label>
            <label>Git refresh interval (seconds)<input type="number" min={1} step={1} value={draft.gitRefreshIntervalSeconds} onChange={(event) => setDraft({ ...draft, gitRefreshIntervalSeconds: Math.max(1, Number(event.target.value) || 0) })} /></label>
          </div>
        ) : null}

        {tab === 'appearance' ? (
          <div className="settings-tab-body">
            <label>Theme<select value={draft.themeId} onChange={(event) => selectTheme(event.target.value)}>
              {themeOptions.map((theme) => <option key={theme.id} value={theme.id}>{theme.label}</option>)}
            </select></label>
            <div className="row gap">
              <button className="ghost" onClick={importEditorTheme}>Import VS Code Theme JSON</button>
              {draft.importedThemes.some((theme) => theme.id === draft.themeId) ? <button className="ghost danger" onClick={removeSelectedTheme}>Remove selected theme</button> : null}
            </div>
            {themeError ? <div className="banner error settings-warning">{themeError}</div> : null}
            <p className="muted config-hint">Imports VS Code theme JSON/JSONC and uses it for the full StackDock UI, Monaco editor, and terminal. Full VS Code extension installation and exact TextMate grammar fidelity are not included.</p>
            <label>Editor font size<input type="number" min={6} value={draft.editor.fontSize} onChange={(event) => setDraft({ ...draft, editor: { ...draft.editor, fontSize: Number(event.target.value) } })} /></label>
            <label>Editor font family<input value={draft.editor.fontFamily} onChange={(event) => setDraft({ ...draft, editor: { ...draft.editor, fontFamily: event.target.value } })} placeholder="e.g. Consolas, monospace" /></label>
            <label>Editor tab size<input type="number" min={1} value={draft.editor.tabSize} onChange={(event) => setDraft({ ...draft, editor: { ...draft.editor, tabSize: Math.max(1, Number(event.target.value) || 1) } })} /></label>
            <label>Editor word wrap<select value={draft.editor.wordWrap} onChange={(event) => setDraft({ ...draft, editor: { ...draft.editor, wordWrap: event.target.value as StackDockSettings['editor']['wordWrap'] } })}><option value="on">On</option><option value="off">Off</option></select></label>
            <label>Terminal font size<input type="number" min={6} value={draft.terminal.fontSize} onChange={(event) => setDraft({ ...draft, terminal: { ...draft.terminal, fontSize: Number(event.target.value) } })} /></label>
            <label>Terminal font family<input value={draft.terminal.fontFamily} onChange={(event) => setDraft({ ...draft, terminal: { ...draft.terminal, fontFamily: event.target.value } })} placeholder="e.g. Consolas, monospace" /></label>
            <label><input type="checkbox" checked={draft.terminal.cursorBlink} onChange={(event) => setDraft({ ...draft, terminal: { ...draft.terminal, cursorBlink: event.target.checked } })} /> Terminal cursor blink</label>
          </div>
        ) : null}

        {tab === 'terminal' ? (
          <div className="settings-tab-body">
            <label>Default profile<select value={draft.defaultTerminalProfileId ?? ''} onChange={(event) => setDraft({ ...draft, defaultTerminalProfileId: event.target.value })}>{draft.terminalProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
            <h3>Terminal profiles</h3>
            <div className="command-list">
              {draft.terminalProfiles.map((profile) => (
                <div className="command-row profile-row" key={profile.id}>
                  <input value={profile.name} onChange={(event) => setDraft({ ...draft, terminalProfiles: draft.terminalProfiles.map((item) => item.id === profile.id ? { ...item, name: event.target.value } : item) })} placeholder="Name" />
                  <input value={profile.shell} onChange={(event) => setDraft({ ...draft, terminalProfiles: draft.terminalProfiles.map((item) => item.id === profile.id ? { ...item, shell: event.target.value } : item) })} placeholder="Shell" />
                  <input value={profile.args.join(' ')} onChange={(event) => setDraft({ ...draft, terminalProfiles: draft.terminalProfiles.map((item) => item.id === profile.id ? { ...item, args: event.target.value.split(' ').filter(Boolean) } : item) })} placeholder="Args" />
                  <button className="ghost danger" onClick={() => setDraft({ ...draft, terminalProfiles: draft.terminalProfiles.filter((item) => item.id !== profile.id) })}>Delete</button>
                </div>
              ))}
            </div>
            <button className="ghost" onClick={() => setDraft({ ...draft, terminalProfiles: [...draft.terminalProfiles, { id: crypto.randomUUID(), name: '', shell: '', args: [] }] })}>Add profile</button>
          </div>
        ) : null}

        {tab === 'workspace' ? (
          <div className="settings-tab-body">
            <p className="muted config-hint">
              Global <code>commands</code> show up in the Ctrl+Shift+P palette. Each workspace edits its own setup
              (default terminal profile, a command run on every new session, and palette commands). Pick a target below.
            </p>
            <label>Editing<select value={selectedKey} disabled={wsLoading} onChange={(event) => selectKey(event.target.value)}>{orderedKeys.map((key) => <option key={key} value={key}>{labelFor(key)}{key === currentWorkspaceId ? ' (current)' : ''}</option>)}</select></label>
            {wsLoading ? (
              <div className="empty-pad muted">Loading…</div>
            ) : (
              <textarea className="config-editor" spellCheck={false} value={selectedText} onChange={(event) => setSlice(selectedKey, event.target.value)} />
            )}
            {!wsLoading && invalidKeys.length ? (
              <div className="banner error settings-warning">Invalid JSON in: {invalidKeys.map(labelFor).join(', ')}. Changes will not be saved until fixed.</div>
            ) : null}
            {wsError ? <div className="banner error config-error">{wsError}</div> : null}
          </div>
        ) : null}

        {tab === 'workspace' ? (
          <div className="modal-actions">
            <button className="ghost" disabled={wsLoading} onClick={() => setSlice(selectedKey, JSON.stringify(selectedKey === GLOBAL_KEY ? [{ id: 'dev', label: 'Start Dev Server', command: 'npm run dev' }] : workspaceTemplate(), null, 2))}>Insert template</button>
            <button className="ghost" onClick={closeWithoutSave}>Close</button>
            <button className="primary" disabled={wsLoading || wsSaving || invalidKeys.length > 0} onClick={saveWorkspace}>{wsSaving ? 'Saving…' : 'Save workspace config'}</button>
          </div>
        ) : (
          <div className="modal-actions">
            <button className="ghost" onClick={closeWithoutSave}>Cancel</button>
            <button className="primary" disabled={!valid || saving} onClick={async () => { setSaving(true); await onSave(draft); setSaving(false); onClose(); }}>{saving ? 'Saving...' : 'Save'}</button>
          </div>
        )}
      </div>
    </div>
  );
}
