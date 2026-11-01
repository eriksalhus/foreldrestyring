import { lgWebos } from './lg-webos.ts';
import type { DriverField, LocalizedText, TvDriver } from './types.ts';

/**
 * Every TV brand the app can control. To add one: write a driver (docs/adding-a-tv.md)
 * and put it here. The first entry is the default for new installations.
 */
export const DRIVERS: readonly TvDriver[] = [lgWebos];

export const DEFAULT_DRIVER_ID = DRIVERS[0].id;

export function getDriver(id: string, drivers: readonly TvDriver[] = DRIVERS): TvDriver | undefined {
  return drivers.find((d) => d.id === id);
}

/** Picks the text for `language`, then English, then any language, so a missing translation never shows nothing. */
export function resolveText(text: LocalizedText | undefined, language: string): string {
  if (text === undefined) return '';
  if (typeof text === 'string') return text;
  return text[language] ?? text.en ?? Object.values(text)[0] ?? '';
}

/** Keeps only the driver's own fields, as trimmed strings. Anything else the client sent is dropped. */
export function sanitizeConfig(driver: TvDriver, raw: unknown): Record<string, string> {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const config: Record<string, string> = {};
  for (const field of driver.fields) {
    const value = source[field.key];
    config[field.key] = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  }
  return config;
}

/** True when every required field has a value. */
export function isConfigured(driver: TvDriver, config: Readonly<Record<string, string>>): boolean {
  return driver.fields.every((f) => !f.required || Boolean(config[f.key]));
}

export interface DriverDescription {
  id: string;
  name: string;
  hint: string;
  canWake: boolean;
  fields: Array<Required<Pick<DriverField, 'key' | 'required'>> & {
    label: string;
    hint: string;
    placeholder: string;
    inputMode: NonNullable<DriverField['inputMode']>;
  }>;
}

/** What the settings page needs to draw the brand picker and each driver's fields, in the user's language. */
export function describeDrivers(language: string, drivers: readonly TvDriver[] = DRIVERS): DriverDescription[] {
  return drivers.map((d) => ({
    id: d.id,
    name: d.name,
    hint: resolveText(d.hint, language),
    canWake: Boolean(d.canWake),
    fields: d.fields.map((f) => ({
      key: f.key,
      required: Boolean(f.required),
      label: resolveText(f.label, language),
      hint: resolveText(f.hint, language),
      placeholder: f.placeholder ?? '',
      inputMode: f.inputMode ?? 'text',
    })),
  }));
}
