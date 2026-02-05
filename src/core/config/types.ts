export type PolicyMode = 'best-effort' | 'strict';

export interface UMFTConfig {
  profile: string;
  policy: PolicyMode;
  diff: {
    timingToleranceTicks?: number;
    tempoToleranceBpm?: number;
    velocityTolerance?: number;
  };
  midi: {
    exportType?: 0 | 1;
    defaultPPQ?: number;
    preserveUnknownMeta?: boolean;
  };
  musicxml: {
    quantize: 'off' | '1/4' | '1/8' | '1/16' | '1/32' | 'custom';
    quantizeCustom?: string[];
    tempoRound?: 0.01 | 0.1 | 1;
    inferTuplets?: boolean;
    splitAcrossMeasures?: boolean;
    dynamicsMapping?: Record<string, unknown>;
    articulationMapping?: Record<string, unknown>;
  };
  aaf: { subset: 'inspect-only' | 'timeline+media' };
  omf: { subset: 'inspect-only' | 'timeline+media' };
}

export interface ConfigLoadResult {
  config: UMFTConfig;
  warnings: string[];
  sources: string[];
}

export interface ConfigLoadOptions {
  cwd?: string;
  configPath?: string;
  strict?: boolean;
}
