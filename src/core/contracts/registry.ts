import { Format } from '../ir';
import { IssueCodes } from '../issues';
import { ContractElementKind, FidelityExpectation, MappingContract } from './types';

export const DEFAULT_TOLERANCES = {
  timingTicks: 2,
  tempoBpm: 0.01,
  velocity: 1,
};

const GENERIC_CONTRACT: MappingContract = {
  name: 'generic',
  version: '1.0',
  source: 'generic',
  target: 'generic',
  tolerances: DEFAULT_TOLERANCES,
  rules: [
    { elementKind: 'note', expectation: 'approximate' },
    { elementKind: 'tempo', expectation: 'approximate' },
    { elementKind: 'timesig', expectation: 'approximate' },
    { elementKind: 'marker', expectation: 'equivalent' },
    { elementKind: 'cc', expectation: 'unsupported' },
    { elementKind: 'pitchbend', expectation: 'unsupported' },
    { elementKind: 'lyric', expectation: 'unsupported' },
    { elementKind: 'dynamic', expectation: 'unsupported' },
    { elementKind: 'articulation', expectation: 'unsupported' },
    { elementKind: 'audioClip', expectation: 'unsupported' },
    { elementKind: 'text', expectation: 'equivalent' },
  ],
};

const CONTRACTS: MappingContract[] = [
  {
    name: 'midi->midi',
    version: '1.0',
    source: 'midi',
    target: 'midi',
    tolerances: DEFAULT_TOLERANCES,
    rules: [
      { elementKind: 'tempo', expectation: 'lossless' },
      { elementKind: 'timesig', expectation: 'lossless' },
      { elementKind: 'marker', expectation: 'equivalent' },
      { elementKind: 'note', expectation: 'lossless' },
      { elementKind: 'cc', expectation: 'lossless' },
      { elementKind: 'pitchbend', expectation: 'lossless' },
      { elementKind: 'lyric', expectation: 'equivalent' },
      { elementKind: 'text', expectation: 'equivalent' },
      { elementKind: 'dynamic', expectation: 'unsupported' },
      { elementKind: 'articulation', expectation: 'unsupported' },
      { elementKind: 'audioClip', expectation: 'unsupported' },
    ],
  },
  {
    name: 'midi->musicxml',
    version: '1.0',
    source: 'midi',
    target: 'musicxml',
    tolerances: DEFAULT_TOLERANCES,
    rules: [
      { elementKind: 'tempo', expectation: 'approximate' },
      { elementKind: 'timesig', expectation: 'approximate' },
      { elementKind: 'marker', expectation: 'equivalent' },
      { elementKind: 'note', expectation: 'approximate' },
      { elementKind: 'cc', expectation: 'unsupported' },
      { elementKind: 'pitchbend', expectation: 'unsupported' },
      { elementKind: 'lyric', expectation: 'approximate' },
      { elementKind: 'text', expectation: 'equivalent' },
      { elementKind: 'dynamic', expectation: 'approximate' },
      { elementKind: 'articulation', expectation: 'approximate' },
      { elementKind: 'audioClip', expectation: 'unsupported' },
    ],
  },
  {
    name: 'musicxml->midi',
    version: '1.0',
    source: 'musicxml',
    target: 'midi',
    tolerances: DEFAULT_TOLERANCES,
    rules: [
      { elementKind: 'tempo', expectation: 'approximate' },
      { elementKind: 'timesig', expectation: 'lossless' },
      { elementKind: 'marker', expectation: 'equivalent' },
      { elementKind: 'note', expectation: 'lossless' },
      { elementKind: 'cc', expectation: 'unsupported' },
      { elementKind: 'pitchbend', expectation: 'unsupported' },
      { elementKind: 'lyric', expectation: 'approximate' },
      { elementKind: 'text', expectation: 'equivalent' },
      { elementKind: 'dynamic', expectation: 'approximate' },
      { elementKind: 'articulation', expectation: 'approximate' },
      { elementKind: 'audioClip', expectation: 'unsupported' },
    ],
  },
];

export interface ContractLookupResult {
  contract: MappingContract;
  usedFallback: boolean;
  issueCode?: string;
}

export function getContract(
  source: Format,
  target: Format,
  _profile?: string,
): ContractLookupResult {
  void _profile;
  const contract = CONTRACTS.find((entry) => entry.source === source && entry.target === target);
  if (!contract) {
    return {
      contract: GENERIC_CONTRACT,
      usedFallback: true,
      issueCode: IssueCodes.CORE_NO_SPECIFIC_CONTRACT,
    };
  }

  return {
    contract,
    usedFallback: false,
  };
}

export function getExpectation(
  contract: MappingContract,
  kind: ContractElementKind,
  fallback: FidelityExpectation = 'approximate',
): FidelityExpectation {
  const rule = contract.rules.find((entry) => entry.elementKind === kind);
  return rule ? rule.expectation : fallback;
}
