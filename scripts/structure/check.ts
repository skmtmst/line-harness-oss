import { auditRepository } from './audit.js';

const report = auditRepository(process.cwd());
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  for (const hit of report.findings) console.error(`${hit.rule}: ${hit.file}${hit.target ? ' → ' + hit.target : ''}\n  ${hit.detail}`);
  console.log(`構成: ${report.files}ファイル / ${report.edges}依存 / 違反${report.findings.length}`);
}
if (report.findings.length) process.exitCode = 1;
