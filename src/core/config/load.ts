import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import os from 'node:os';
import { DEFAULT_CONFIG } from './defaults';
import { ConfigLoadOptions, ConfigLoadResult, UMFTConfig } from './types';
import { mergeConfig } from './merge';
import { sha256Hex, stableStringify } from '../io';

const CONFIG_FILENAME = '.umft.json';

export async function loadConfig(options: ConfigLoadOptions = {}): Promise<ConfigLoadResult> {
  const cwd = options.cwd ?? process.cwd();
  const sources: string[] = [];
  const warnings: string[] = [];

  let config = DEFAULT_CONFIG;

  const globalPath = resolve(os.homedir(), CONFIG_FILENAME);
  const globalConfig = await readConfigFile(globalPath, warnings);
  if (globalConfig) {
    sources.push(globalPath);
    config = mergeConfig(config, globalConfig);
  }

  const projectPath = await findUpwardsConfig(cwd);
  if (projectPath) {
    const projectConfig = await readConfigFile(projectPath, warnings);
    if (projectConfig) {
      sources.push(projectPath);
      config = mergeConfig(config, projectConfig);
    }
  }

  if (options.configPath) {
    const overridePath = resolve(options.configPath);
    const overrideConfig = await readConfigFile(overridePath, warnings, options.strict ?? false);
    if (overrideConfig) {
      sources.push(overridePath);
      config = mergeConfig(config, overrideConfig);
    }
  }

  return { config, warnings, sources };
}

export function hashConfig(config: UMFTConfig): string {
  const canonical = stableStringify(config);
  return `sha256:${sha256Hex(canonical)}`;
}

async function readConfigFile(
  filePath: string,
  warnings: string[],
  strict = false,
): Promise<Partial<UMFTConfig> | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const { config, unknownKeys } = validateConfig(parsed);
    if (unknownKeys.length) {
      const message = `Unknown config keys ignored: ${unknownKeys.join(', ')}`;
      if (strict) {
        throw new Error(message);
      }
      warnings.push(message);
    }
    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    warnings.push(`Failed to read config ${filePath}: ${(error as Error).message}`);
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
