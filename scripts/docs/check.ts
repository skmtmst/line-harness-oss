import { resolve } from 'node:path';
import { auditCatalog } from './catalog.js';

const findings = auditCatalog(resolve(process.argv[2] ?? process.cwd()));
if (findings.length) {
  for (const finding of findings) console.error(`${finding.source}: ${finding.problem}: ${finding.target}`);
  process.exitCode = 1;
} else console.log('文書の入口・掲載回数・ローカルリンク：合格');
