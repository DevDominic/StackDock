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

const UI_FONT_PRESETS = [
  {
    label: 'Inter',
    family: '"Inter Variable", "Inter", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
    note: 'Clean modern UI font. FontAlternatives: replaces 102 premium fonts.',
  },
  {
    label: 'Montserrat',
    family: '"Montserrat", "Inter Variable", "Inter", system-ui, sans-serif',
    note: 'Geometric and polished. FontAlternatives: replaces 23 premium fonts.',
  },
  {
    label: 'Barlow',
    family: '"Barlow", "Inter Variable", "Inter", system-ui, sans-serif',
    note: 'Friendly, slightly condensed. FontAlternatives: replaces 22 premium fonts.',
  },
  {
    label: 'Geist',
    family: '"Geist Variable", "Geist", "Inter Variable", "Inter", system-ui, sans-serif',
    note: 'Crisp modern product UI. FontAlternatives: replaces 12 premium fonts.',
  },
  {
    label: 'Google Sans Flex',
    family: '"Google Sans Flex", "Inter Variable", "Inter", system-ui, sans-serif',
    note: 'Soft Google-style interface font. No replacement count listed.',
  },
  {
    label: 'Segoe UI',
    family: '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
    note: 'Native Windows app feel. Listed as premium on FontAlternatives.',
  },
  {
    label: 'System UI',
    family: 'system-ui, sans-serif',
    note: 'Uses platform default UI font. Not listed as a specific font.',
  },
] as const;

const UI_FONT_PREVIEW = 'StackDock Settings — Clean panels, tabs, buttons, and labels';

function findUiFontPreset(fontFamily: string) {
  return UI_FONT_PRESETS.find((preset) => preset.family === fontFamily);
}

function cleanUiFontFamily(fontFamily: string) {
  return fontFamily.trim() || UI_FONT_PRESETS[0].family;
}

const CODE_FONT_PRESETS = [
  {
    label: 'JetBrains Mono',
    family: '"JetBrains Mono Variable", "JetBrains Mono", "Cascadia Code", Consolas, monospace',
    note: 'Crisp coding font. FontAlternatives: replaces 17 premium fonts.',
  },
  {
    label: 'Fira Code',
    family: '"Fira Code Variable", "Fira Code", "Cascadia Code", Consolas, monospace',
    note: 'Ligature-focused. FontAlternatives: replaces 13 premium fonts.',
  },
  {
    label: 'Source Code Pro',
    family: '"Source Code Pro", "Cascadia Code", Consolas, monospace',
    note: 'Adobe coding font. FontAlternatives: replaces 8 premium fonts.',
  },
  {
    label: 'Geist Mono',
    family: '"Geist Mono Variable", "Geist Mono", "Cascadia Code", Consolas, monospace',
    note: 'Minimal modern monospace. FontAlternatives: replaces 5 premium fonts.',
  },
  {
    label: 'Fira Mono',
    family: '"Fira Mono", "Cascadia Code", Consolas, monospace',
    note: 'Simple Mozilla monospace. FontAlternatives: replaces 4 premium fonts.',
  },
  {
    label: 'Monaspace Neon',
    family: '"Monaspace Neon", "Cascadia Code", Consolas, monospace',
    note: 'Monaspace texture healing + coding ligatures. Neon variant not listed as free font.',
  },
  {
    label: 'Cascadia Code',
    family: '"Cascadia Code", Consolas, monospace',
    note: 'Windows-native coding font. Listed as premium on FontAlternatives.',
  },
  {
    label: 'Consolas',
    family: 'Consolas, monospace',
    note: 'Classic Windows monospace. Listed as premium on FontAlternatives.',
  },
] as const;

const CODE_FONT_PREVIEW = 'function dock<T>(value: T) => value ?? "StackDock";  // => !== === <= >=';

function findCodeFontPreset(fontFamily: string) {
  return CODE_FONT_PRESETS.find((preset) => preset.family === fontFamily);
}

function cleanCodeFontFamily(fontFamily: string) {
  return fontFamily.trim() || CODE_FONT_PRESETS[0].family;
}

function cleanSetup(setup: WorkspaceSetup): WorkspaceSetup {
  const out: WorkspaceSetup = {};
  if (setup.defaultTerminalProfile?.trim()) out.defaultTerminalProfile = setup.defaultTerminalProfile.trim();
  if (setup.newSessionCommand?.trim()) out.newSessionCommand = setup.newSessionCommand;
  const commands = (setup.commands ?? []).filter((command) => command.label.trim() && command.command.trim());
  if (commands.length) out.commands = commands;
  return out;
}

function setWindowOverlayDimmed(dimmed: boolean) {
  const styles = getComputedStyle(document.documentElement);
  if (dimmed) {
    void api.app.setTitleBarOverlay({ color: '#050507', symbolColor: '#6f7280', height: 43 });
    return;
  }
  void api.app.setTitleBarOverlay({
    color: styles.getPropertyValue('--titlebar-bg').trim() || '#08090d',
    symbolColor: styles.getPropertyValue('--titlebar-fg').trim() || '#e7e7e7',
    height: 43,
  });
}

export function SettingsModal({ settings, currentWorkspaceId, initialTab, onSave, onAutomationSaved, onRunCommand, onClose }: Props) {
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? 'general');
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);
  const [uiFontCustomOpen, setUiFontCustomOpen] = useState(false);
  const [codeFontCustomOpen, setCodeFontCustomOpen] = useState(false);
  const valid = draft.terminalProfiles.every((profile) => profile.name.trim() && profile.shell.trim());
  const themeOptions = useMemo(() => getThemes(draft.importedThemes), [draft.importedThemes]);

  useEffect(() => {
    setWindowOverlayDimmed(true);
    return () => setWindowOverlayDimmed(false);
  }, []);

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
    document.documentElement.style.setProperty('--ui-font', settings.ui.fontFamily);
    document.documentElement.style.setProperty('--ui-font-size', `${settings.ui.fontSize}px`);
    applyTheme(settings.themeId, settings.importedThemes);
    onClose();
  }

  const uiFontFamily = cleanUiFontFamily(draft.ui.fontFamily);
  const uiFontPreset = findUiFontPreset(uiFontFamily);

  function setUiFontFamily(fontFamily: string) {
    const next = cleanUiFontFamily(fontFamily);
    document.documentElement.style.setProperty('--ui-font', next);
    setDraft({ ...draft, ui: { ...draft.ui, fontFamily: next } });
  }

  function setUiFontSize(fontSize: number) {
    const next = Math.max(10, Number(fontSize) || 13);
    document.documentElement.style.setProperty('--ui-font-size', `${next}px`);
    setDraft({ ...draft, ui: { ...draft.ui, fontSize: next } });
  }

  const codeFontFamily = draft.editor.fontFamily === draft.terminal.fontFamily
    ? cleanCodeFontFamily(draft.editor.fontFamily)
    : cleanCodeFontFamily(draft.editor.fontFamily || draft.terminal.fontFamily);
  const codeFontPreset = findCodeFontPreset(codeFontFamily);

  function setCodeFontFamily(fontFamily: string) {
    const next = cleanCodeFontFamily(fontFamily);
    setDraft({
      ...draft,
      editor: { ...draft.editor, fontFamily: next },
      terminal: { ...draft.terminal, fontFamily: next },
    });
  }

  return (
    <div className="modal-backdrop" onMouseDown={closeWithoutSave}>
      <div className="modal settings-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="panel-title row"><span>Settings</span><button className="ghost" onClick={closeWithoutSave}>×</button></div>
        <div className="topbar-nav settings-tabs">
          <button className={tab === 'general' ? 'active-toggle' : ''} onClick={() => setTab('general')}>General</button>
          <button className={tab === 'appearance' ? 'active-toggle' : ''} onClick={() => setTab('appearance')}>Appearance</button>
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
            <label>UI font
              <select value={uiFontCustomOpen || !uiFontPreset ? 'custom' : uiFontPreset.family} onChange={(event) => {
                if (event.target.value === 'custom') {
                  setUiFontCustomOpen(true);
                  return;
                }
                setUiFontCustomOpen(false);
                setUiFontFamily(event.target.value);
              }}>
                {UI_FONT_PRESETS.map((preset) => <option key={preset.family} value={preset.family}>{preset.label}</option>)}
                <option value="custom">Custom</option>
              </select>
              <div className="ui-font-preview" style={{ fontFamily: uiFontFamily, fontSize: draft.ui.fontSize }}>{UI_FONT_PREVIEW}</div>
              <span className="muted code-font-note">{uiFontCustomOpen ? 'Custom UI font for app chrome, panels, labels, and buttons.' : uiFontPreset?.note ?? 'Custom UI font for app chrome, panels, labels, and buttons.'}</span>
            </label>
            {uiFontCustomOpen || !uiFontPreset ? <label>Custom UI font family<input value={uiFontFamily} onChange={(event) => setUiFontFamily(event.target.value)} placeholder="e.g. Inter, Segoe UI, system-ui" /></label> : null}
            <label>UI font size<input type="number" min={10} max={18} value={draft.ui.fontSize} onChange={(event) => setUiFontSize(Number(event.target.value))} /></label>
            <label>Code font
              <select value={codeFontCustomOpen || !codeFontPreset ? 'custom' : codeFontPreset.family} onChange={(event) => {
                if (event.target.value === 'custom') {
                  setCodeFontCustomOpen(true);
                  return;
                }
                setCodeFontCustomOpen(false);
                setCodeFontFamily(event.target.value);
              }}>
                {CODE_FONT_PRESETS.map((preset) => <option key={preset.family} value={preset.family}>{preset.label}</option>)}
                <option value="custom">Custom</option>
              </select>
              <div className="code-font-preview" style={{ fontFamily: codeFontFamily, fontFeatureSettings: draft.code.ligatures ? undefined : 'normal' }}>{CODE_FONT_PREVIEW}</div>
              <span className="muted code-font-note">{codeFontCustomOpen ? 'Custom font family for editor and terminal only.' : codeFontPreset?.note ?? 'Custom font family for editor and terminal only.'}</span>
            </label>
            {codeFontCustomOpen || !codeFontPreset ? <label>Custom code font family<input value={codeFontFamily} onChange={(event) => setCodeFontFamily(event.target.value)} placeholder="e.g. JetBrains Mono, Consolas, monospace" /></label> : null}
            <label><input type="checkbox" checked={draft.code.ligatures} onChange={(event) => setDraft({ ...draft, code: { ...draft.code, ligatures: event.target.checked } })} /> Code ligatures</label>
            <label>Editor font size<input type="number" min={6} value={draft.editor.fontSize} onChange={(event) => setDraft({ ...draft, editor: { ...draft.editor, fontSize: Number(event.target.value) } })} /></label>
            <label>Editor tab size<input type="number" min={1} value={draft.editor.tabSize} onChange={(event) => setDraft({ ...draft, editor: { ...draft.editor, tabSize: Math.max(1, Number(event.target.value) || 1) } })} /></label>
            <label>Editor word wrap<select value={draft.editor.wordWrap} onChange={(event) => setDraft({ ...draft, editor: { ...draft.editor, wordWrap: event.target.value as StackDockSettings['editor']['wordWrap'] } })}><option value="on">On</option><option value="off">Off</option></select></label>
            <label>Terminal font size<input type="number" min={6} value={draft.terminal.fontSize} onChange={(event) => setDraft({ ...draft, terminal: { ...draft.terminal, fontSize: Number(event.target.value) } })} /></label>
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
