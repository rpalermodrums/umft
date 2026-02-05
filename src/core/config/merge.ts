import { UMFTConfig } from './types';

export function mergeConfig(base: UMFTConfig, override: Partial<UMFTConfig>): UMFTConfig {
  return {
    ...base,
    ...override,
    diff: { ...base.diff, ...override.diff },
    midi: { ...base.midi, ...override.midi },
    musicxml: { ...base.musicxml, ...override.musicxml },
    aaf: { ...base.aaf, ...override.aaf },
    omf: { ...base.omf, ...override.omf },
  };
}
