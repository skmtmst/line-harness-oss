import { publishWorker, publishAdmin } from './publish.js';
import { preflight, verifyReleaseCheckout } from './preflight.js';
import { applyDatabase, assertNoPending, planDatabase } from './database.js';
import { backupDatabase } from './backup.js';
import { prepareWorker, prepareAdmin, verifyHeaders, verifyPages } from './artifacts.js';
import { verifyResponses } from './responses.js';
import { assertSha, requireValue, result } from './common.js';

async function main(): Promise<void> {
  const action = process.argv[2], sha = requireValue(process.env.RELEASE_SHA);
  assertSha(sha);
  // Every production entry repeats the immutable main / caller check.
  verifyReleaseCheckout(sha);
  switch (action) {
    case 'preflight': await preflight(sha, requireValue(process.env.STAGING_RUN_ID)); break;
    case 'plan': console.log(`pending_count: ${planDatabase()}`); break;
    case 'backup': await backupDatabase(sha); break;
    case 'apply': applyDatabase(sha); break;
    case 'no-pending': assertNoPending(); break;
    case 'worker-artifact': prepareWorker(sha); verifyHeaders('worker'); break;
    case 'admin-artifact': prepareAdmin(); break;
    case 'worker-responses': await verifyResponses('worker'); break;
    case 'admin-responses': await verifyResponses('admin'); break;
    case 'deploy-worker': publishWorker(sha); break;
    case 'deploy-admin': publishAdmin(sha); break;
    case 'pages': await verifyPages(sha); break;
    default: throw new Error('unknown_action');
  }
}
// Exceptions may contain provider bodies or paths. Log only the fixed command's result.
const action = process.argv[2];
const label = ['preflight', 'plan', 'backup', 'apply', 'no-pending', 'worker-artifact', 'admin-artifact', 'worker-responses', 'admin-responses', 'pages', 'deploy-worker', 'deploy-admin'].includes(action) ? action : 'arguments';
main().then(() => result(label, true)).catch(() => { result(label, false); process.exitCode = 1; });
