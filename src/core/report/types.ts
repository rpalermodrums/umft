import { Issue } from '../issues';
import { Format } from '../ir';
import { MappingContract } from '../contracts';

export type ReportFormat = Format | 'unknown';

export interface ConversionReport {
  reportSchemaVersion: '1.0';
  tool: {
    name: 'umft';
    version: string;
    commit?: string;
  };
  run: {
    timestampISO: string;
    policy: 'best-effort' | 'strict';
    profile: string;
    configHash: string;
    platform: {
      node: string;
      os: string;
      arch: string;
    };
  };
  input: {
    path: string;
    format: ReportFormat;
    detectedBy: 'sniff' | 'extension' | 'user';
  };
  output: {
    path: string;
    format: Format;
  };
  contract: {
    name: string;
    version: string;
    tolerances: MappingContract['tolerances'];
  };
  summary: {
    elementsTotal: number;
    perfect: number;
    equivalent: number;
    approximate: number;
    dropped: number;
    errors: number;
  };
  stats: {
    tracksIn: number;
    tracksOut: number;
    notesIn: number;
    notesOut: number;
    tempoEventsIn: number;
    tempoEventsOut: number;
    markersIn: number;
    markersOut: number;
  };
  trackMappings: TrackMappingReport[];
  issues: Issue[];
  diffs?: DiffSummary;
  diagnostics?: AdapterDiagnostics;
}

export interface TrackMappingReport {
  sourceTrackId: string;
  sourceName: string;
  targetPartId: string;
  targetName: string;
  stats: {
    notes: number;
    controllers: number;
  };
  fidelity: {
    perfect: number;
    approximate: number;
    dropped: number;
  };
}

export interface DiffSummary {
  addedElements: number;
}

export interface AdapterDiagnostics {
  parseWarnings?: string[];
  exportWarnings?: string[];
  configWarnings?: string[];
}
