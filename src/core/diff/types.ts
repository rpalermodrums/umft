import { Issue } from '../issues';
import { IRTrack } from '../ir';

export type FidelityClass = 'PERFECT' | 'EQUIVALENT' | 'APPROXIMATE' | 'DROPPED' | 'ERROR';

export interface DiffSummary {
  elementsTotal: number;
  perfect: number;
  equivalent: number;
  approximate: number;
  dropped: number;
  errors: number;
}

export interface TrackMappingDiff {
  source: IRTrack;
  target: IRTrack;
  summary: DiffSummary;
}

export interface DiffResult {
  summary: DiffSummary;
  issues: Issue[];
  addedElements: number;
  trackMappings: TrackMappingDiff[];
}
