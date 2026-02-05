import { UMFTConfig } from './types';

export const DEFAULT_CONFIG: UMFTConfig = {
  profile: 'default',
  policy: 'best-effort',
  diff: {
    timingToleranceTicks: undefined,
    tempoToleranceBpm: 0.01,
    velocityTolerance: 1,
  },
  midi: {
    exportType: 1,
    defaultPPQ: 960,
    preserveUnknownMeta: true,
  },
  musicxml: {
    quantize: '1/16',
    tempoRound: 0.01,
    inferTuplets: false,
    splitAcrossMeasures: true,
  },
  aaf: { subset: 'inspect-only' },
  omf: { subset: 'inspect-only' },
};
