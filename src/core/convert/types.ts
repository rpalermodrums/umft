import { UMFTConfig } from '../config';
import { Issue } from '../issues';
import { Format, IRProject } from '../ir';

export interface ConvertJob {
  inputPath: string;
  inputFormat?: Format;
  targetFormat: Format;
  outPath: string;
  reportPath: string;
  policy: 'best-effort' | 'strict';
  profile: string;
  config: UMFTConfig;
  configIssues?: Issue[];
  configWarnings?: string[];
  flags: {
    overwrite: boolean;
    emitIrDir?: string;
    reportFormat: 'json' | 'md' | 'both';
    noReport?: boolean;
  };
}

export interface ConvertResult {
  exitCode: number;
  report?: unknown;
  ir0?: IRProject;
  ir1?: IRProject;
}
