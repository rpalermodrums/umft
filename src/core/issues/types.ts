export type Severity = 'INFO' | 'WARN' | 'ERROR';

export type IssueCategory =
  | 'TIMING'
  | 'NOTATION'
  | 'TEMPO'
  | 'CONTROLLERS'
  | 'STRUCTURE'
  | 'MEDIA'
  | 'METADATA'
  | 'OTHER';

export type SourceLocation =
  | { format: 'midi'; trackIndex?: number; tick?: number; channel?: number }
  | { format: 'musicxml'; partId?: string; measure?: number; beat?: number; xpath?: string }
  | { format: 'aaf' | 'omf'; trackName?: string; startSample?: number; objectPath?: string }
  | { format: 'ir'; trackId?: string; tick?: number };

export interface Issue {
  code: string;
  severity: Severity;
  category: IssueCategory;
  message: string;
  sourceLocation?: SourceLocation;
  targetLocation?: SourceLocation;
  elementIds?: string[];
  count?: number;
  suggestedFix?: string;
  docsRef?: string;
}
