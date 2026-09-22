// Player settings with safe localStorage persistence (private mode / blocked storage just
// falls back to defaults in memory).
import type { Notation } from '../core/format';

export interface SettingsValues {
  muted: boolean;
  /** 0..1 */
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  /** Tones down shake, punches and camera motion. */
  reduceMotion: boolean;
  /** Tones down full-screen flashes. */
  reduceFlashes: boolean;
  notation: Notation;
}

export const DEFAULT_SETTINGS: Readonly<SettingsValues> = {
  muted: false,
  masterVolume: 0.8,
  sfxVolume: 0.8,
  musicVolume: 0.6,
  reduceMotion: false,
  reduceFlashes: false,
  notation: 'letters',
};

const KEY = 'scale.settings.v1';

type Listener = (s: Readonly<SettingsValues>, key: keyof SettingsValues) => void;

export class Settings {
  private values: SettingsValues = { ...DEFAULT_SETTINGS };
  private listeners: Listener[] = [];

  constructor(private readonly storage: Storage | null = safeStorage()) {
    this.load();
  }

  get<K extends keyof SettingsValues>(key: K): SettingsValues[K] {
    return this.values[key];
  }

  get all(): Readonly<SettingsValues> {
    return this.values;
  }

  set<K extends keyof SettingsValues>(key: K, value: SettingsValues[K]): void {
    if (this.values[key] === value) return;
    this.values[key] = value;
    this.save();
    for (const l of this.listeners) l(this.values, key);
  }

  /** Called on every change (and never during construction). Returns unsubscribe. */
  onChange(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private load(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Record<keyof SettingsValues, unknown>>;
      const v = this.values;
      for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof SettingsValues)[]) {
        const d = DEFAULT_SETTINGS[k];
        const p = parsed[k];
        if (typeof p !== typeof d) continue;
        if (typeof p === 'number' && !Number.isFinite(p)) continue;
        (v as unknown as Record<string, unknown>)[k] = typeof p === 'number' ? Math.min(1, Math.max(0, p)) : p;
      }
      if (v.notation !== 'letters' && v.notation !== 'scientific') v.notation = 'letters';
    } catch {
      // Corrupt or inaccessible: keep defaults.
    }
  }

  private save(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(KEY, JSON.stringify(this.values));
    } catch {
      // Quota or privacy mode: settings just won't persist.
    }
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
