import { Issue, Severity } from './types';

export interface AggregateOptions {
  maxElementIds?: number;
}

const DEFAULT_MAX_ELEMENT_IDS = 50;
const SEVERITY_ORDER: Record<Severity, number> = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
};

export function aggregateIssues(issues: Issue[], options: AggregateOptions = {}): Issue[] {
  const maxElementIds = options.maxElementIds ?? DEFAULT_MAX_ELEMENT_IDS;
  const buckets = new Map<string, Issue>();

  for (const issue of issues) {
    const key = buildKey(issue);
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, {
        ...issue,
        elementIds: issue.elementIds ? issue.elementIds.slice(0, maxElementIds) : undefined,
        count: issue.count ?? 1,
      });
      continue;
    }

    existing.count = (existing.count ?? 1) + (issue.count ?? 1);

    if (issue.elementIds?.length) {
      const merged = [...(existing.elementIds ?? []), ...issue.elementIds];
      existing.elementIds = merged.slice(0, maxElementIds);
    }

    if (compareLocations(issue.sourceLocation, existing.sourceLocation) < 0) {
      existing.sourceLocation = issue.sourceLocation;
    }
  }

  return sortIssues([...buckets.values()]);
}

export function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => {
    const severityOrder = compareNumbers(SEVERITY_ORDER[a.severity], SEVERITY_ORDER[b.severity]);
    if (severityOrder !== 0) {
      return severityOrder;
    }

    const codeOrder = compareStrings(a.code, b.code);
    if (codeOrder !== 0) {
      return codeOrder;
    }

    const categoryOrder = compareStrings(a.category, b.category);
    if (categoryOrder !== 0) {
      return categoryOrder;
    }

    return compareStrings(locationKey(a.sourceLocation), locationKey(b.sourceLocation));
  });
}

function buildKey(issue: Issue): string {
  return [issue.code, issue.severity, issue.category, issue.message].join('|');
}

function locationKey(location?: Issue['sourceLocation']): string {
  if (!location) {
    return '';
  }
  return JSON.stringify(location);
}

function compareLocations(a?: Issue['sourceLocation'], b?: Issue['sourceLocation']): number {
  return compareStrings(locationKey(a), locationKey(b));
}

function compareNumbers(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

function compareStrings(a?: string | null, b?: string | null): number {
  const left = a ?? '';
  const right = b ?? '';
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
