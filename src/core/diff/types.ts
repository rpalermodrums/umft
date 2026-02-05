import { Issue } from '../issues';

export type FidelityClass = 'PERFECT' | 'EQUIVALENT' | 'APPROXIMATE' | 'DROPPED' | 'ERROR';

export interface DiffSummary {
  elementsTotal: number;
  perfect: number;
  equivalent: number;
  approximate: number;
  dropped: number;
  errors: number;
}

export interface DiffResult {
  summary: DiffSummary;
  issues: Issue[];
  addedElements: number;
}
