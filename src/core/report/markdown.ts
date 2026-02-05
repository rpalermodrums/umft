import { ConversionReport } from './types';
import { sortIssues } from '../issues';

export function formatReportMarkdown(report: ConversionReport): string {
  const lines: string[] = [];
  lines.push('# UMFT Conversion Report');
  lines.push('');
  lines.push(`- Input: ${report.input.path} (${report.input.format})`);
  lines.push(`- Output: ${report.output.path} (${report.output.format})`);
  lines.push(`- Policy: ${report.run.policy}`);
  lines.push(`- Profile: ${report.run.profile}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- PERFECT: ${report.summary.perfect}`);
  lines.push(`- EQUIVALENT: ${report.summary.equivalent}`);
  lines.push(`- APPROXIMATE: ${report.summary.approximate}`);
  lines.push(`- DROPPED: ${report.summary.dropped}`);
  lines.push(`- ERRORS: ${report.summary.errors}`);
  lines.push('');

  const issues = sortIssues(report.issues);
  if (issues.length) {
    lines.push('## Issues');
    lines.push('');
    issues.forEach((issue, index) => {
      const count = issue.count && issue.count > 1 ? ` (x${issue.count})` : '';
      lines.push(`${index + 1}. ${issue.code} (${issue.severity}): ${issue.message}${count}`);
    });
  } else {
    lines.push('## Issues');
    lines.push('');
    lines.push('No issues reported.');
  }

  lines.push('');
  lines.push('## Provenance');
  lines.push('');
  lines.push(`- Tool: ${report.tool.name} ${report.tool.version}`);
  lines.push(`- Timestamp: ${report.run.timestampISO}`);
  lines.push(`- Config Hash: ${report.run.configHash}`);

  return lines.join('\n');
}
