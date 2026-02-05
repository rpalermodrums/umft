import { promises as fs } from 'node:fs';
import {
  FormatAdapter,
  InspectResult,
  ImportOptions,
  ImportResult,
  ExportOptions,
  ExportResult,
} from '../types';

export const omfAdapter: FormatAdapter = {
  format: 'omf',
  async sniff(_input: Buffer, pathHint?: string): Promise<boolean> {
    return Boolean(pathHint?.toLowerCase().endsWith('.omf'));
  },
  async inspect(path: string): Promise<InspectResult> {
    const stats = await fs.stat(path);
    return {
      format: 'omf',
      details: {
        size: stats.size,
        subset: 'inspect-only',
      },
      warnings: ['OMF inspect-only subset in v0.1'],
    };
  },
  async import(path: string, opts: ImportOptions): Promise<ImportResult> {
    void path;
    void opts;
    throw new Error('OMF import not implemented in v0.1 (inspect-only)');
  },
  async export(ir: unknown, path: string, opts: ExportOptions): Promise<ExportResult> {
    void ir;
    void path;
    void opts;
    throw new Error('OMF export not implemented in v0.1 (inspect-only)');
  },
  capabilities() {
    return { supportsImport: false, supportsExport: false, supportsInspect: true };
  },
};
