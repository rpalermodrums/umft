import { Issue } from '../core/issues';
import { IRProject, Format } from '../core/ir';

export interface AdapterCapabilities {
  supportsImport: boolean;
  supportsExport: boolean;
  supportsInspect: boolean;
}

export interface InspectResult {
  format: Format;
  details: Record<string, unknown>;
  warnings: string[];
}

export interface ImportOptions {
  defaultPPQ?: number;
}

export interface ExportOptions {
  overwrite?: boolean;
}

export interface ImportResult {
  ir: IRProject;
  warnings: string[];
  issues: Issue[];
}

export interface ExportResult {
  warnings: string[];
  issues: Issue[];
}

export interface FormatAdapter {
  format: Format;
  sniff(input: Buffer, pathHint?: string): Promise<boolean>;
  inspect(path: string): Promise<InspectResult>;
  import(path: string, opts: ImportOptions): Promise<ImportResult>;
  export(ir: IRProject, path: string, opts: ExportOptions): Promise<ExportResult>;
  capabilities(): AdapterCapabilities;
}
