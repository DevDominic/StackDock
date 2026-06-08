import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { getErrorMessage } from '../../lib/errors';
import { DEFAULT_THEME_ID, applyTheme, getThemes, parseVsCodeThemeJson, registerThemes } from '../../lib/themeSupport';
import type { AutomationConfig, PaletteCommand, StackDockSettings, Workspace, WorkspaceSetup } from '../../shared/types';
import { CommandsEditor } from './CommandsEditor';

export type SettingsTab = 'general' | 'appearance' | 'terminal' | 'workspace';

interface Props {
  settings: StackDockSettings;
  currentWorkspaceId: string;
  initialTab?: SettingsTab;
  onSave(settings: StackDockSettings): Promise<void>;
  onAutomationSaved(config: AutomationConfig): void;
  /** Run a command from a command card. Absent when Settings is opened with no active workspace. */
  onRunCommand?(command: PaletteCommand): void;
  onClose(): void;
}

const GLOBAL_KEY = '__global__';

function cleanSetup(setup: WorkspaceSetup): WorkspaceSetup {
  const out: WorkspaceSetup = {};
  if (setup.defaultTerminalProfile?.trim()) out.defaultTerminalProfile = setup.defaultTerminalProfile.trim();
  if (setup.newSessionCommand?.trim()) out.newSessionCommand = setup.newSessionCommand;
  const commands = (setup.commands ?? []).filter((command) => command.label.trim() && command.command.trim());
  if (commands.length) out.commands = commands;
  return out;
}

export function SettingsModal({ settings, currentWorkspaceId, initialTab, onSave, onAutomationSaved, onRunCommand, onClose }: Props) {
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? 'general');
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);
  const valid = draft.terminalProfiles.every((profile) => profile.name.trim() && profile.shell.trim());
  const themeOptions = useMemo(() => getThemes(draft.importedThemes), [draft.importedThemes]);

  // Workspace tab (automation.json) state — held as a typed AutomationConfig and
  // edited through forms, then serialized back on save.
  const [wsLoading, setWsLoading] = useState(true);
  const [wsSaving, setWsSaving] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [config, setConfig] = useState<AutomationConfig | null>(null);
  const [originalKeys, setOriginalKeys] = useState<Set<string>>(new Set());
  const [keyOrder, setKeyOrder] = useState<string[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>(currentWorkspaceId || GLOBAL_KEY);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [loaded, list] = await Promise.all([api.automation.load(), api.workspaces.list()]);
        if (!active) return;
        setWorkspaces(list);
        setConfig(loaded);
        setOriginalKeys(new Set(Object.keys(loaded.workspaces)));

        const listIds = list.map((w) => w.id);
        const orphanIds = Object.keys(loaded.workspaces).filter((id) => !listIds.includes(id));
        // currentWorkspaceId is empty when Settings is opened from the home screen (no active workspace).
        const hasCurrent = !!currentWorkspaceId && (listIds.includes(currentWorkspaceId) || orphanIds.includes(currentWorkspaceId));
        const ordered = [
          ...(hasCurrent ? [currentWorkspaceId] : []),
          ...listIds.filter((id) => id !== currentWorkspaceId),
          ...orphanIds.filter((id) => id !== currentWorkspaceId),
        ];
        setKeyOrder(ordered);
        setSelectedKey(hasCurrent ? currentWorkspaceId : GLOBAL_KEY);
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

  const setup: WorkspaceSetup = (config?.workspaces[selectedKey]) ?? {};
  const selectedWorkspacePath = workspaces.find((w) => w.id === selectedKey)?.path;

  function setGlobalCommands(commands: PaletteCommand[]) {
    setConfig((prev) => (prev ? { ...prev, commands } : prev));
  }

  function patchSetup(patch: Partial<WorkspaceSetup>) {
    setConfig((prev) => {
      if (!prev) return prev;
      const current = prev.workspaces[selectedKey] ?? {};
      return { ...prev, workspaces: { ...prev.workspaces, [selectedKey]: { ...current, ...patch } } };
    });
  }

  async function saveWorkspace() {
    if (!config) return;
    setWsSaving(true);
    setWsError(null);
    try {
      const workspacesObj: Record<string, WorkspaceSetup> = {};
      for (const [key, value] of Object.entries(config.workspaces)) {
        const cleaned = cleanSetup(value);
        const isEmpty = !cleaned.defaultTerminalProfile && !cleaned.newSessionCommand && !cleaned.commands?.length;
        // Keep entries the user actually configured; preserve originals so clearing one isn't a surprise.
        if (!isEmpty || originalKeys.has(key)) workspacesObj[key] = cleaned;
      }
      const merged = { commands: config.commands, workspaces: workspacesObj };
      const saved = await api.automation.saveRaw(JSON.stringify(merged, null, 2));
      setOriginalKeys(new Set(Object.keys(saved.workspaces)));
      onAutomationSaved(saved);
    } catch (err) {
      setWsError(getErrorMessage(err, 'Could not save workspace config'));
    } finally {
      setWsSaving(false);
    }
  }

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
              <b>Global commands</b> show up in every workspace's Ctrl+Shift+P palette and run in the current workspace's folder.
              Each workspace can also set its default terminal profile, a command run on every new session, and its own commands.
            </p>
            <label>Editing<select value={selectedKey} disabled={wsLoading} onChange={(event) => setSelectedKey(event.target.value)}>{orderedKeys.map((key) => <option key={key} value={key}>{labelFor(key)}{key === currentWorkspaceId ? ' (current)' : ''}</option>)}</select></label>
            {wsLoading || !config ? (
              <div className="empty-pad muted">Loading…</div>
            ) : selectedKey === GLOBAL_KEY ? (
              <CommandsEditor commands={config.commands} onChange={setGlobalCommands} onRun={onRunCommand} cwdPlaceholder="Current workspace folder" />
            ) : (
              <>
                <label>Default terminal profile<select value={setup.defaultTerminalProfile ?? ''} onChange={(event) => patchSetup({ defaultTerminalProfile: event.target.value || undefined })}>
                  <option value="">Use global default</option>
                  {draft.terminalProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                </select></label>
                <label>Run on every new session <span className="muted">(optional)</span><input value={setup.newSessionCommand ?? ''} onChange={(event) => patchSetup({ newSessionCommand: event.target.value || undefined })} placeholder="e.g. nvm use" /></label>
                <h3>Commands</h3>
                <CommandsEditor commands={setup.commands ?? []} onChange={(commands) => patchSetup({ commands })} onRun={onRunCommand} showSessionFields cwdPlaceholder={selectedWorkspacePath} />
              </>
            )}
            {wsError ? <div className="banner error config-error">{wsError}</div> : null}
          </div>
        ) : null}

        {tab === 'workspace' ? (
          <div className="modal-actions">
            <button className="ghost" onClick={closeWithoutSave}>Close</button>
            <button className="primary" disabled={wsLoading || wsSaving || !config} onClick={saveWorkspace}>{wsSaving ? 'Saving…' : 'Save workspace config'}</button>
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
