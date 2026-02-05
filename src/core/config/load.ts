import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import os from 'node:os';
import { DEFAULT_CONFIG } from './defaults';
import { ConfigLoadOptions, ConfigLoadResult, UMFTConfig } from './types';
import { mergeConfig } from './merge';
import { sha256Hex, stableStringify } from '../io';
import { Issue, IssueCodes } from '../issues';

const CONFIG_FILENAME = '.umft.json';

export async function loadConfig(options: ConfigLoadOptions = {}): Promise<ConfigLoadResult> {
  const cwd = options.cwd ?? process.cwd();
  const sources: string[] = [];
  const warnings: string[] = [];
  const issues: Issue[] = [];

  let config = DEFAULT_CONFIG;

  const globalPath = resolve(os.homedir(), CONFIG_FILENAME);
  const globalConfig = await readConfigFile(globalPath, warnings, issues);
  if (globalConfig) {
    sources.push(globalPath);
    config = mergeConfig(config, globalConfig);
  }

  const projectPath = await findUpwardsConfig(cwd);
  if (projectPath) {
    const projectConfig = await readConfigFile(projectPath, warnings, issues);
    if (projectConfig) {
      sources.push(projectPath);
      config = mergeConfig(config, projectConfig);
    }
  }

  if (options.configPath) {
    const overridePath = resolve(options.configPath);
    const overrideConfig = await readConfigFile(
      overridePath,
      warnings,
      issues,
      options.strict ?? false,
    );
    if (overrideConfig) {
      sources.push(overridePath);
      config = mergeConfig(config, overrideConfig);
    }
  }

  return { config, warnings, sources, issues };
}

export function hashConfig(config: UMFTConfig): string {
  const canonical = stableStringify(config);
  return `sha256:${sha256Hex(canonical)}`;
}

async function readConfigFile(
  filePath: string,
  warnings: string[],
  issues: Issue[],
  strict = false,
): Promise<Partial<UMFTConfig> | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const { config, unknownKeys } = validateConfig(parsed);
    if (unknownKeys.length) {
      const message = `Unknown config keys ignored: ${unknownKeys.join(', ')}`;
      warnings.push(message);
      issues.push({
        code: IssueCodes.CORE_CONFIG_UNKNOWN_KEYS,
        severity: 'WARN',
        category: 'STRUCTURE',
        message,
      });
      if (strict) {
        issues.push({
          code: IssueCodes.CORE_CONFIG_INVALID,
          severity: 'ERROR',
          category: 'STRUCTURE',
          message: `Invalid config: ${message}`,
        });
        return null;
      }
    }
    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    const message = `Invalid config: ${(error as Error).message}`;
    warnings.push(`Failed to read config ${filePath}: ${(error as Error).message}`);
    issues.push({
      code: IssueCodes.CORE_CONFIG_INVALID,
      severity: 'ERROR',
      category: 'STRUCTURE',
      message,
    });
    return null;
  }
}

async function findUpwardsConfig(startDir: string): Promise<string | null> {
  let current = resolve(startDir);
  let parent = dirname(current);
  while (parent !== current) {
    const candidate = resolve(current, CONFIG_FILENAME);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // ignore
    }
    current = parent;
    parent = dirname(current);
  }
  const candidate = resolve(current, CONFIG_FILENAME);
  try {
    await fs.access(candidate);
    return candidate;
  } catch {
    return null;
  }
}

function validateConfig(input: Record<string, unknown>): {
  config: Partial<UMFTConfig>;
  unknownKeys: string[];
} {
  const allowedKeys = new Set(['profile', 'policy', 'diff', 'midi', 'musicxml', 'aaf', 'omf']);

  const unknownKeys = Object.keys(input).filter((key) => !allowedKeys.has(key));

  const config: Partial<UMFTConfig> = {};
  if (typeof input.profile === 'string') {
    config.profile = input.profile;
  }
  if (input.policy === 'best-effort' || input.policy === 'strict') {
    config.policy = input.policy;
  }
  if (typeof input.diff === 'object' && input.diff !== null) {
    config.diff = input.diff as UMFTConfig['diff'];
  }
  if (typeof input.midi === 'object' && input.midi !== null) {
    config.midi = input.midi as UMFTConfig['midi'];
  }
  if (typeof input.musicxml === 'object' && input.musicxml !== null) {
    config.musicxml = input.musicxml as UMFTConfig['musicxml'];
  }
  if (typeof input.aaf === 'object' && input.aaf !== null) {
    config.aaf = input.aaf as UMFTConfig['aaf'];
  }
  if (typeof input.omf === 'object' && input.omf !== null) {
    config.omf = input.omf as UMFTConfig['omf'];
  }

  return { config, unknownKeys };
}
