import type { ExtensionConfigField, ExtensionConfigPrimitive, StackDockSettings } from '../shared/types';

export type ExtensionConfigValues = Record<string, ExtensionConfigPrimitive>;

export function getExtensionConfig(settings: StackDockSettings | null | undefined, extensionId: string, defaults: ExtensionConfigValues = {}): ExtensionConfigValues {
  return { ...defaults, ...(settings?.extensions.config?.[extensionId] ?? {}) };
}

export function setExtensionConfig(settings: StackDockSettings, extensionId: string, patch: ExtensionConfigValues): StackDockSettings {
  return {
    ...settings,
    extensions: {
      ...settings.extensions,
      config: {
        ...(settings.extensions.config ?? {}),
        [extensionId]: { ...(settings.extensions.config?.[extensionId] ?? {}), ...patch },
      },
    },
  };
}

export function defaultsFromFields(fields: ExtensionConfigField[] | undefined): ExtensionConfigValues {
  const defaults: ExtensionConfigValues = {};
  for (const field of fields ?? []) if (field.default !== undefined) defaults[field.key] = field.default;
  return defaults;
}

export function coerceConfigValue(field: ExtensionConfigField, value: unknown): ExtensionConfigPrimitive {
  if (field.type === 'boolean') return !!value;
  if (field.type === 'number') {
    const min = field.min ?? -Infinity;
    const max = field.max ?? Infinity;
    return Math.min(max, Math.max(min, Number(value) || Number(field.default) || 0));
  }
  const stringValue = String(value ?? field.default ?? '');
  if (field.type === 'select' && field.options?.length) return field.options.some((option) => option.value === stringValue) ? stringValue : field.options[0].value;
  return stringValue;
}
