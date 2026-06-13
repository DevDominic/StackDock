import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { getErrorMessage } from '../../lib/errors';
import { DEFAULT_THEME_ID, applyTheme, getThemes, parseVsCodeThemeJson, registerThemes } from '../../lib/themeSupport';
import type { AutomationConfig, ExtensionConfigField, ExtensionConfigPrimitive, ExtensionListResult, ExtensionManifest, PaletteCommand, StackDockSettings, Workspace, WorkspaceSetup } from '../../shared/types';
import { BUILTIN_KEYBIND_COMMANDS, DEFAULT_KEYBINDS, EXTENSION_KEYBIND_COMMANDS } from '../../shared/defaultKeybinds';
import { findKeybindConflicts, formatKeybind, normalizeKeybind } from '../../shared/keybinds';
import { CommandsEditor } from './CommandsEditor';
import { JsonCodeEditor } from './JsonCodeEditor';
import { useExtensions } from '../../extensions/ExtensionProvider';
import { coerceConfigValue, defaultsFromFields, getExtensionConfig, setExtensionConfig } from '../../extensions/configuration';

export type SettingsTab = 'general' | 'appearance' | 'terminal' | 'extensions' | 'workspace' | 'keybinds';

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

function buildPersistableAutomation(config: AutomationConfig, originalKeys: Set<string>): AutomationConfig {
  const workspaces: Record<string, WorkspaceSetup> = {};
  for (const [key, value] of Object.entries(config.workspaces)) {
    const cleaned = cleanSetup(value);
    const isEmpty = !cleaned.defaultTerminalProfile && !cleaned.newSessionCommand && !cleaned.commands?.length;
    // Keep entries the user actually configured; preserve originals so clearing one isn't a surprise.
    if (!isEmpty || originalKeys.has(key)) workspaces[key] = cleaned;
  }
  return { commands: config.commands, workspaces };
}

type WorkspaceJsonSetup = WorkspaceSetup & { rootDirectory?: string; path?: string; name?: string };

function stripWorkspaceJsonMetadata(raw: unknown): AutomationConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Config must be a JSON object with "commands" and "workspaces"');
  const record = raw as { commands?: unknown; workspaces?: unknown };
  const workspaces: Record<string, WorkspaceSetup> = {};
  if (record.workspaces && typeof record.workspaces === 'object' && !Array.isArray(record.workspaces)) {
    for (const [key, value] of Object.entries(record.workspaces as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        workspaces[key] = {};
        continue;
      }
      const { defaultTerminalProfile, newSessionCommand, commands } = value as WorkspaceJsonSetup;
      workspaces[key] = { defaultTerminalProfile, newSessionCommand, commands };
    }
  }
  return { commands: Array.isArray(record.commands) ? record.commands as PaletteCommand[] : [], workspaces };
}

function extensionEnabled(manifest: ExtensionManifest, settings: StackDockSettings) {
  let enabled = manifest.defaultEnabled === true;
  if (settings.extensions.enabled.includes(manifest.id)) enabled = true;
  if (settings.extensions.disabled.includes(manifest.id)) enabled = false;
  return enabled;
}

function setExtensionEnabled(settings: StackDockSettings, extensionId: string, enabled: boolean): StackDockSettings {
  return {
    ...settings,
    extensions: {
      ...settings.extensions,
      enabled: enabled ? [...new Set([...settings.extensions.enabled, extensionId])] : settings.extensions.enabled.filter((id) => id !== extensionId),
      disabled: enabled ? settings.extensions.disabled.filter((id) => id !== extensionId) : [...new Set([...settings.extensions.disabled, extensionId])],
    },
  };
}

function extensionSourceLabel(manifest: ExtensionManifest) {
  return manifest.source === 'local' ? `Local${manifest.packagePath ? ` — ${manifest.packagePath}` : ''}` : 'Bundled with StackDock';
}

function extensionInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'EX';
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
}

function KeybindRecorder({ value, onChange }: { value?: string; onChange(value: string): void }) {
  return (
    <div className="keybind-editor">
      <button className="keybind-recorder" onKeyDown={(event) => {
        event.preventDefault(); event.stopPropagation();
        const next = normalizeKeybind([event.ctrlKey || event.metaKey ? 'Mod' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', event.key].filter(Boolean).join('+'));
        if (next) onChange(next);
      }}>{value ? formatKeybind(value) : 'Unbound — press keys'}</button>
      {value ? <button className="ghost" onClick={() => onChange('')}>Clear</button> : null}
    </div>
  );
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
  const [selectedExtensionConfigId, setSelectedExtensionConfigId] = useState<string | null>(null);
  const extensionRegistry = useExtensions();
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
  const [workspaceViewMode, setWorkspaceViewMode] = useState<'ui' | 'json'>('ui');
  const [workspaceJson, setWorkspaceJson] = useState('');
  const [workspaceJsonDirty, setWorkspaceJsonDirty] = useState(false);
  const [wsSaved, setWsSaved] = useState(false);
  const [extensionResult, setExtensionResult] = useState<ExtensionListResult>({ extensions: [], errors: [] });
  const [extensionError, setExtensionError] = useState<string | null>(null);
  const [extensionsLoading, setExtensionsLoading] = useState(false);

  async function loadExtensions() {
    setExtensionsLoading(true);
    setExtensionError(null);
    try {
      setExtensionResult(await api.extensions.list());
    } catch (err) {
      setExtensionError(getErrorMessage(err, 'Could not load extensions'));
    } finally {
      setExtensionsLoading(false);
    }
  }

  useEffect(() => { void loadExtensions(); }, []);

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

  function formatWorkspaceJson(source: AutomationConfig): string {
    const automation = buildPersistableAutomation(source, originalKeys);
    const withWorkspaceRoots: Record<string, WorkspaceJsonSetup> = {};
    const keys = Array.from(new Set([...Object.keys(automation.workspaces), ...workspaces.map((workspace) => workspace.id)]));
    for (const key of keys) {
      const workspace = workspaces.find((item) => item.id === key);
      withWorkspaceRoots[key] = {
        ...(workspace ? { name: workspace.name, rootDirectory: workspace.path } : {}),
        ...(automation.workspaces[key] ?? {}),
      };
    }
    return JSON.stringify({ commands: automation.commands, workspaces: withWorkspaceRoots }, null, 2);
  }

  async function updateWorkspaceRootsFromJson(raw: unknown): Promise<Workspace[]> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Config must be a JSON object with "commands" and "workspaces"');
    const rawWorkspaces = (raw as { workspaces?: unknown }).workspaces;
    if (!rawWorkspaces || typeof rawWorkspaces !== 'object' || Array.isArray(rawWorkspaces)) return workspaces;
    let nextWorkspaces = workspaces;
    for (const [key, value] of Object.entries(rawWorkspaces as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const rootDirectory = (value as WorkspaceJsonSetup).rootDirectory ?? (value as WorkspaceJsonSetup).path;
      if (typeof rootDirectory !== 'string' || !rootDirectory.trim()) continue;
      const workspace = nextWorkspaces.find((item) => item.id === key);
      if (!workspace || workspace.path === rootDirectory) continue;
      const updated = await api.workspaces.update({ ...workspace, path: rootDirectory.trim() });
      nextWorkspaces = nextWorkspaces.map((item) => (item.id === updated.id ? updated : item));
    }
    setWorkspaces(nextWorkspaces);
    return nextWorkspaces;
  }

  function setGlobalCommands(commands: PaletteCommand[]) {
    setWsSaved(false);
    setConfig((prev) => (prev ? { ...prev, commands } : prev));
  }

  function patchSetup(patch: Partial<WorkspaceSetup>) {
    setWsSaved(false);
    setConfig((prev) => {
      if (!prev) return prev;
      const current = prev.workspaces[selectedKey] ?? {};
      return { ...prev, workspaces: { ...prev.workspaces, [selectedKey]: { ...current, ...patch } } };
    });
  }

  function showWorkspaceJsonMode() {
    if (!config) return;
    setWorkspaceJson(formatWorkspaceJson(config));
    setWorkspaceJsonDirty(false);
    setWsError(null);
    setWsSaved(false);
    setWorkspaceViewMode('json');
  }

  function showWorkspaceUiMode() {
    if (workspaceJsonDirty && !window.confirm('Discard unsaved JSON changes and return to UI mode?')) return;
    setWsError(null);
    setWorkspaceJsonDirty(false);
    setWorkspaceViewMode('ui');
  }

  async function saveWorkspace() {
    if (!config) return;
    setWsSaving(true);
    setWsError(null);
    setWsSaved(false);
    try {
      let saved: AutomationConfig;
      let updatedWorkspaces = workspaces;
      if (workspaceViewMode === 'json') {
        const parsed = JSON.parse(workspaceJson);
        updatedWorkspaces = await updateWorkspaceRootsFromJson(parsed);
        const automation = stripWorkspaceJsonMetadata(parsed);
        saved = await api.automation.saveRaw(JSON.stringify(automation, null, 2));
      } else {
        saved = await api.automation.saveRaw(JSON.stringify(buildPersistableAutomation(config, originalKeys), null, 2));
      }
      setConfig(saved);
      setOriginalKeys(new Set(Object.keys(saved.workspaces)));
      if (workspaceViewMode === 'json') {
        const withWorkspaceRoots: Record<string, WorkspaceJsonSetup> = {};
        const keys = Array.from(new Set([...Object.keys(saved.workspaces), ...updatedWorkspaces.map((workspace) => workspace.id)]));
        for (const key of keys) {
          const workspace = updatedWorkspaces.find((item) => item.id === key);
          withWorkspaceRoots[key] = {
            ...(workspace ? { name: workspace.name, rootDirectory: workspace.path } : {}),
            ...(saved.workspaces[key] ?? {}),
          };
        }
        setWorkspaceJson(JSON.stringify({ commands: saved.commands, workspaces: withWorkspaceRoots }, null, 2));
        setWorkspaceJsonDirty(false);
      }
      onAutomationSaved(saved);
      setWsSaved(true);
    } catch (err) {
      setWsError(getErrorMessage(err, 'Could not save workspace config'));
    } finally {
      setWsSaving(false);
    }
  }

  async function saveKeybindSettings() {
    setSaving(true);
    setWsSaving(true);
    setWsError(null);
    try {
      const savedSettings = await onSave(draft);
      if (config) {
        const savedAutomation = await api.automation.saveRaw(JSON.stringify(buildPersistableAutomation(config, originalKeys), null, 2));
        setConfig(savedAutomation);
        onAutomationSaved(savedAutomation);
      }
      setWsSaved(true);
      return savedSettings;
    } catch (err) {
      setWsError(getErrorMessage(err, 'Could not save keybinds'));
    } finally {
      setSaving(false);
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
  const enabledExtensionCount = extensionResult.extensions.filter((extension) => extensionEnabled(extension, draft)).length;
  const localExtensionCount = extensionResult.extensions.filter((extension) => extension.source === 'local').length;

  function setCodeFontFamily(fontFamily: string) {
    const next = cleanCodeFontFamily(fontFamily);
    setDraft({
      ...draft,
      editor: { ...draft.editor, fontFamily: next },
      terminal: { ...draft.terminal, fontFamily: next },
    });
  }

  function patchExtensionConfig(extensionId: string, patch: Record<string, ExtensionConfigPrimitive>) {
    setDraft((current) => setExtensionConfig(current, extensionId, patch));
  }

  const currentWorkspaceCommands = selectedKey !== GLOBAL_KEY ? (config?.workspaces[selectedKey]?.commands ?? []) : [];
  const extensionKeybindSections = extensionResult.extensions
    .filter((extension) => extensionEnabled(extension, draft) && EXTENSION_KEYBIND_COMMANDS[extension.id]?.length)
    .map((extension) => ({ extension, commands: EXTENSION_KEYBIND_COMMANDS[extension.id] }));
  const keybindEntries = [
    ...BUILTIN_KEYBIND_COMMANDS.map(([id, label]) => ({ id, label, keybind: draft.keybinds[id] })),
    ...extensionKeybindSections.flatMap(({ extension, commands }) => commands.map(([id, label]) => ({ id, label: `${extension.name}: ${label}`, keybind: draft.keybinds[id] }))),
    ...(config?.commands ?? []).map((command) => ({ id: `global:${command.id}`, label: `Global: ${command.label}`, keybind: command.keybind })),
    ...currentWorkspaceCommands.map((command) => ({ id: `ws:${command.id}`, label: `Workspace: ${command.label}`, keybind: command.keybind })),
  ];
  const keybindConflicts = findKeybindConflicts(keybindEntries);

  function setBuiltinKeybind(id: string, keybind: string) {
    setDraft((current) => ({ ...current, keybinds: { ...current.keybinds, [id]: normalizeKeybind(keybind) ?? '' } }));
  }

  function setCommandKeybind(scope: 'global' | 'workspace', id: string, keybind: string) {
    const normalized = normalizeKeybind(keybind) ?? undefined;
    setWsSaved(false);
    setConfig((prev) => {
      if (!prev) return prev;
      if (scope === 'global') return { ...prev, commands: prev.commands.map((command) => command.id === id ? { ...command, keybind: normalized } : command) };
      const current = prev.workspaces[selectedKey] ?? {};
      return { ...prev, workspaces: { ...prev.workspaces, [selectedKey]: { ...current, commands: (current.commands ?? []).map((command) => command.id === id ? { ...command, keybind: normalized } : command) } } };
    });
  }

  function renderConfigField(extensionId: string, field: ExtensionConfigField, value: ExtensionConfigPrimitive | undefined) {
    const setValue = (next: unknown) => patchExtensionConfig(extensionId, { [field.key]: coerceConfigValue(field, next) });
    if (field.type === 'boolean') return <label className="checkbox-field" key={field.key}><input type="checkbox" checked={value === true} onChange={(event) => setValue(event.target.checked)} /> {field.label}</label>;
    if (field.type === 'select') return <label key={field.key}>{field.label}<select value={String(value ?? field.default ?? '')} onChange={(event) => setValue(event.target.value)}>{(field.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{field.description ? <span className="muted code-font-note">{field.description}</span> : null}</label>;
    if (field.type === 'number') return <label key={field.key}>{field.label}<input type="number" min={field.min} max={field.max} step={field.step} value={Number(value ?? field.default ?? 0)} onChange={(event) => setValue(event.target.value)} />{field.description ? <span className="muted code-font-note">{field.description}</span> : null}</label>;
    return <label key={field.key}>{field.label}<input value={String(value ?? field.default ?? '')} onChange={(event) => setValue(event.target.value)} />{field.description ? <span className="muted code-font-note">{field.description}</span> : null}</label>;
  }

  function renderExtensionConfigView(extension: ExtensionManifest) {
    const native = extensionRegistry.nativeExtensions.get(extension.id);
    const fields = extension.contributes?.configuration?.fields ?? [];
    const config = getExtensionConfig(draft, extension.id, defaultsFromFields(fields));
    return <div className="settings-tab-body extension-settings-body"><button className="ghost extension-back" onClick={() => setSelectedExtensionConfigId(null)}>← Back to extensions</button><div className="extension-hero"><div><span className="extension-kicker">Extension configuration</span><h3>{extension.contributes?.configuration?.title ?? extension.name}</h3><p className="muted config-hint">{extension.id}</p></div></div>{native?.renderSettings ? native.renderSettings({ manifest: extension, settings: draft, config, setConfig: (patch) => patchExtensionConfig(extension.id, patch) }) : <div className="extension-config-form">{fields.map((field) => renderConfigField(extension.id, field, config[field.key]))}</div>}</div>;
  }

  return (
    <div className="modal-backdrop" onMouseDown={closeWithoutSave}>
      <div className="modal settings-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="panel-title row"><span>Settings</span><button className="ghost" onClick={closeWithoutSave}>×</button></div>
        <div className="topbar-nav settings-tabs">
          <button className={tab === 'general' ? 'active-toggle' : ''} onClick={() => setTab('general')}>General</button>
          <button className={tab === 'appearance' ? 'active-toggle' : ''} onClick={() => setTab('appearance')}>Appearance</button>
          <button className={tab === 'terminal' ? 'active-toggle' : ''} onClick={() => setTab('terminal')}>Terminal profiles</button>
          <button className={tab === 'extensions' ? 'active-toggle' : ''} onClick={() => setTab('extensions')}>Extensions</button>
          <button className={tab === 'workspace' ? 'active-toggle' : ''} onClick={() => setTab('workspace')}>Workspace</button>
          <button className={tab === 'keybinds' ? 'active-toggle' : ''} onClick={() => setTab('keybinds')}>Keybinds</button>
        </div>

        {tab === 'general' ? (
          <div className="settings-tab-body">
            <label><input type="checkbox" checked={draft.openLinksExternally} onChange={(event) => setDraft({ ...draft, openLinksExternally: event.target.checked })} /> Open terminal links in system browser</label>
            <label><input type="checkbox" checked={draft.captureTerminalBrowserOpens} onChange={(event) => setDraft({ ...draft, captureTerminalBrowserOpens: event.target.checked })} /> Capture browser opens from terminal tools (applies to new terminals)</label>
            {draft.captureTerminalBrowserOpens ? (
              <label>Captured pages open as{' '}
                <select value={draft.capturedLinkOpenMode} onChange={(event) => setDraft({ ...draft, capturedLinkOpenMode: event.target.value as StackDockSettings['capturedLinkOpenMode'] })}>
                  <option value="tab">New tab</option>
                  <option value="split-right">Tab + split right</option>
                  <option value="split-left">Tab + split left</option>
                  <option value="split-up">Tab + split up</option>
                  <option value="split-down">Tab + split down</option>
                </select>
              </label>
            ) : null}
            <label><input type="checkbox" checked={draft.autoSave} onChange={(event) => setDraft({ ...draft, autoSave: event.target.checked })} /> Auto save</label>
            <label>Auto save delay (ms)<input type="number" min={200} step={100} disabled={!draft.autoSave} value={draft.autoSaveDelayMs} onChange={(event) => setDraft({ ...draft, autoSaveDelayMs: Math.max(200, Number(event.target.value) || 0) })} /></label>
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
            <label><input type="checkbox" checked={draft.terminal.startAtBottom} onChange={(event) => setDraft({ ...draft, terminal: { ...draft.terminal, startAtBottom: event.target.checked } })} /> Start new terminals at bottom</label>
          </div>
        ) : null}

        {tab === 'terminal' ? (
          <div className="settings-tab-body">
            <label>Default profile<select value={draft.defaultTerminalProfileId ?? ''} onChange={(event) => setDraft({ ...draft, defaultTerminalProfileId: event.target.value })}>{draft.terminalProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
            <h3>Terminal profiles</h3>
            <p className="muted config-hint">Optional startup command runs after the shell opens; e.g. Pi uses <code>cmd.exe</code> + <code>pi</code>.</p>
            <div className="command-list">
              {draft.terminalProfiles.map((profile) => (
                <div className="command-row profile-row" key={profile.id}>
                  <input value={profile.name} onChange={(event) => setDraft({ ...draft, terminalProfiles: draft.terminalProfiles.map((item) => item.id === profile.id ? { ...item, name: event.target.value } : item) })} placeholder="Name" />
                  <input value={profile.shell} onChange={(event) => setDraft({ ...draft, terminalProfiles: draft.terminalProfiles.map((item) => item.id === profile.id ? { ...item, shell: event.target.value } : item) })} placeholder="Shell" />
                  <input value={profile.args.join(' ')} onChange={(event) => setDraft({ ...draft, terminalProfiles: draft.terminalProfiles.map((item) => item.id === profile.id ? { ...item, args: event.target.value.split(' ').filter(Boolean) } : item) })} placeholder="Args" />
                  <input value={profile.startupCommand ?? ''} onChange={(event) => setDraft({ ...draft, terminalProfiles: draft.terminalProfiles.map((item) => item.id === profile.id ? { ...item, startupCommand: event.target.value || undefined } : item) })} placeholder="Startup command (optional)" />
                  <button className="ghost danger" onClick={() => setDraft({ ...draft, terminalProfiles: draft.terminalProfiles.filter((item) => item.id !== profile.id) })}>Delete</button>
                </div>
              ))}
            </div>
            <button className="ghost" onClick={() => setDraft({ ...draft, terminalProfiles: [...draft.terminalProfiles, { id: crypto.randomUUID(), name: '', shell: '', args: [] }] })}>Add profile</button>
          </div>
        ) : null}

        {tab === 'extensions' && selectedExtensionConfigId ? (
          extensionResult.extensions.find((extension) => extension.id === selectedExtensionConfigId) ? renderExtensionConfigView(extensionResult.extensions.find((extension) => extension.id === selectedExtensionConfigId)!) : <div className="settings-tab-body"><button className="ghost" onClick={() => setSelectedExtensionConfigId(null)}>← Back to extensions</button><p className="muted">Extension not found.</p></div>
        ) : null}

        {tab === 'extensions' && !selectedExtensionConfigId ? (
          <div className="settings-tab-body extension-settings-body">
            <div className="extension-hero">
              <div>
                <span className="extension-kicker">Extension manager</span>
                <h3>Customize StackDock surfaces</h3>
                <p className="muted config-hint">Enable bundled UI pieces or add local extension packages. Save settings to apply visibility changes.</p>
              </div>
              <div className="extension-stats" aria-label="Extension summary">
                <span><b>{enabledExtensionCount}</b> enabled</span>
                <span><b>{extensionResult.extensions.length}</b> total</span>
                <span><b>{localExtensionCount}</b> local</span>
              </div>
            </div>
            <div className="row gap extension-actions">
              <button className="ghost" disabled={extensionsLoading} onClick={loadExtensions}>{extensionsLoading ? 'Loading…' : 'Reload extensions'}</button>
              <button className="primary" onClick={async () => {
                const folder = await api.app.pickWorkspaceFolder();
                if (!folder) return;
                const result = await api.extensions.addLocalPackage(folder);
                setExtensionResult(result);
                setDraft({ ...draft, extensions: { ...draft.extensions, localPackagePaths: [...new Set([...draft.extensions.localPackagePaths, folder])] } });
              }}>Add local package</button>
            </div>
            {extensionError ? <div className="banner error settings-warning">{extensionError}</div> : null}
            {extensionResult.errors.length ? (
              <div className="banner error settings-warning">
                {extensionResult.errors.map((error, index) => <div key={`${error.packagePath ?? error.extensionId ?? 'extension'}:${index}`}>{error.packagePath ?? error.extensionId ?? 'Extension'}: {error.message}</div>)}
              </div>
            ) : null}
            <div className="extension-grid">
              {extensionResult.extensions.map((extension) => {
                const enabled = extensionEnabled(extension, draft);
                const views = extension.contributes?.views?.length ?? 0;
                const statusItems = extension.contributes?.statusBar?.length ?? 0;
                const source = extension.source === 'local' ? 'local' : 'bundled';
                const configurable = !!extension.contributes?.configuration || !!extensionRegistry.nativeExtensions.get(extension.id)?.renderSettings;
                return (
                  <div className={`extension-card ${enabled ? 'is-enabled' : 'is-disabled'}`} key={extension.id}>
                    <div className="extension-glyph" aria-hidden="true">{extensionInitials(extension.name)}</div>
                    <div className="extension-main">
                      <div className="extension-title-line">
                        <span className="extension-name">{extension.name}</span>
                        <span className={`extension-badge ${source}`}>{source === 'local' ? 'Local' : 'Bundled'}</span>
                      </div>
                      <div className="extension-id">{extension.id}</div>
                      {extension.description ? <p className="extension-description">{extension.description}</p> : null}
                      <div className="extension-meta">
                        <span>{views} view{views === 1 ? '' : 's'}</span>
                        <span>{statusItems} status item{statusItems === 1 ? '' : 's'}</span>
                        {extension.packagePath ? <span className="extension-path" title={extension.packagePath}>{extension.packagePath}</span> : null}
                      </div>
                    </div>
                    <div className="extension-card-actions">
                      <label className="extension-switch checkbox-field" title={enabled ? 'Enabled' : 'Disabled'}>
                        <input type="checkbox" checked={enabled} onChange={(event) => setDraft(setExtensionEnabled(draft, extension.id, event.target.checked))} />
                        <span>{enabled ? 'On' : 'Off'}</span>
                      </label>
                      {configurable ? <button className="ghost" onClick={() => setSelectedExtensionConfigId(extension.id)}>Configure</button> : null}
                      {extension.source === 'local' && extension.packagePath ? <button className="ghost danger" onClick={async () => {
                        const result = await api.extensions.removeLocalPackage(extension.packagePath!);
                        setExtensionResult(result);
                        setDraft({ ...draft, extensions: { ...draft.extensions, localPackagePaths: draft.extensions.localPackagePaths.filter((item) => item !== extension.packagePath), enabled: draft.extensions.enabled.filter((id) => id !== extension.id), disabled: draft.extensions.disabled.filter((id) => id !== extension.id) } });
                      }}>Remove</button> : null}
                    </div>
                  </div>
                );
              })}
              {!extensionResult.extensions.length && !extensionsLoading ? <div className="empty-pad muted extension-empty">No extensions found.</div> : null}
            </div>
            <p className="muted config-hint extension-save-note">Disabling a default extension hides that built-in surface.</p>
          </div>
        ) : null}

        {tab === 'keybinds' ? (
          <div className="settings-tab-body keybinds-settings-body">
            <p className="muted config-hint">Click a shortcut button, then press the desired key combination. Custom command keybinds are saved to automation.json.</p>
            <h3>Built-in commands</h3>
            <div className="keybind-list">
              {BUILTIN_KEYBIND_COMMANDS.map(([id, label]) => (
                <div className="keybind-row" key={id}>
                  <span>{label}</span>
                  <KeybindRecorder value={draft.keybinds[id]} onChange={(value) => setBuiltinKeybind(id, value)} />
                  <button className="ghost" onClick={() => setBuiltinKeybind(id, DEFAULT_KEYBINDS[id] ?? '')}>Reset</button>
                </div>
              ))}
            </div>
            {extensionKeybindSections.length ? <h3>Extension commands</h3> : null}
            {extensionKeybindSections.map(({ extension, commands }) => (
              <div className="keybind-list" key={extension.id}>
                <p className="muted config-hint">{extension.name}</p>
                {commands.map(([id, label]) => (
                  <div className="keybind-row" key={id}>
                    <span>{label}</span>
                    <KeybindRecorder value={draft.keybinds[id]} onChange={(value) => setBuiltinKeybind(id, value)} />
                    <button className="ghost" onClick={() => setBuiltinKeybind(id, DEFAULT_KEYBINDS[id] ?? '')}>Reset</button>
                  </div>
                ))}
              </div>
            ))}
            <h3>Custom commands</h3>
            {!config ? <div className="empty-pad muted">Loading…</div> : (
              <div className="keybind-list">
                {config.commands.map((command) => <div className="keybind-row" key={`global:${command.id}`}><span>Global: {command.label}</span><KeybindRecorder value={command.keybind} onChange={(value) => setCommandKeybind('global', command.id, value)} /></div>)}
                {currentWorkspaceCommands.map((command) => <div className="keybind-row" key={`ws:${command.id}`}><span>Workspace: {command.label}</span><KeybindRecorder value={command.keybind} onChange={(value) => setCommandKeybind('workspace', command.id, value)} /></div>)}
                {!config.commands.length && !currentWorkspaceCommands.length ? <p className="muted config-hint">No custom commands yet. Add them in the Workspace tab.</p> : null}
              </div>
            )}
            {keybindConflicts.length ? <div className="banner error settings-warning">{keybindConflicts.map((conflict) => <div key={conflict.keybind}><b>{formatKeybind(conflict.keybind)}</b>: {conflict.items.map((item) => item.label).join(', ')}</div>)}</div> : null}
          </div>
        ) : null}

        {tab === 'workspace' ? (
          <div className="settings-tab-body">
            <p className="muted config-hint">
              <b>Global commands</b> show up in every workspace's Ctrl+Shift+P palette and run in the current workspace's folder.
              Each workspace can also set its default terminal profile, a command run on every new session, and its own commands.
            </p>
            {wsLoading || !config ? (
              <div className="empty-pad muted">Loading…</div>
            ) : workspaceViewMode === 'json' ? (
              <>
                <p className="muted config-hint">Edit automation JSON directly. Change a workspace's <code>rootDirectory</code> to move that project's root. Save validates and normalizes the file.</p>
                <JsonCodeEditor
                  className="config-editor workspace-json-editor monaco-json-editor"
                  value={workspaceJson}
                  settings={draft}
                  onChange={(next) => {
                    setWorkspaceJson(next);
                    setWorkspaceJsonDirty(true);
                    setWsSaved(false);
                  }}
                />
              </>
            ) : (
              <>
                <label>Editing<select value={selectedKey} disabled={wsLoading} onChange={(event) => setSelectedKey(event.target.value)}>{orderedKeys.map((key) => <option key={key} value={key}>{labelFor(key)}{key === currentWorkspaceId ? ' (current)' : ''}</option>)}</select></label>
                {selectedKey === GLOBAL_KEY ? (
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
              </>
            )}
            {wsError ? <div className="banner error config-error">{wsError}</div> : null}
          </div>
        ) : null}

        {tab === 'workspace' ? (
          <div className="modal-actions workspace-modal-actions">
            <button className="ghost" disabled={wsLoading || !config} onClick={workspaceViewMode === 'ui' ? showWorkspaceJsonMode : showWorkspaceUiMode}>
              {workspaceViewMode === 'ui' ? 'View JSON Mode' : 'View UI Mode'}
            </button>
            <div className="workspace-save-actions">
              {wsSaved && !wsSaving ? <span className="muted workspace-save-status">Saved</span> : null}
              {workspaceViewMode === 'json' && workspaceJsonDirty && !wsSaved && !wsSaving ? <span className="muted workspace-save-status">Unsaved JSON changes</span> : null}
              <button className="primary" disabled={wsLoading || wsSaving || !config} onClick={saveWorkspace}>{wsSaving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        ) : tab === 'keybinds' ? (
          <div className="modal-actions">
            <button className="ghost" onClick={closeWithoutSave}>Cancel</button>
            <button className="primary" disabled={saving || wsSaving} onClick={async () => { await saveKeybindSettings(); onClose(); }}>{saving || wsSaving ? 'Saving...' : 'Save'}</button>
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
