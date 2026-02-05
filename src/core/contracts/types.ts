import { IREvent } from '../ir';

export type FidelityExpectation = 'lossless' | 'equivalent' | 'approximate' | 'unsupported';

export type ContractElementKind = IREvent['kind'] | 'tempo' | 'timesig' | 'marker' | 'audioClip';

export interface ContractRule {
  elementKind: ContractElementKind;
  expectation: FidelityExpectation;
  notes?: string;
}

export interface MappingContract {
  name: string;
  version: string;
  source: string;
  target: string;
  tolerances: {
    timingTicks: number;
    tempoBpm: number;
    velocity: number;
  };
  rules: ContractRule[];
}
