import type { Context } from 'hono';
import type { Env } from '../worker-env.js';
import { unhandledWorkerError } from '../lib/unhandled-error.js';
import type { StarterCatalogRuntime } from '../services/style-starter-catalog-apply.js';

/** 登録の確定後に起きた投入障害も、共通の事故記録へ渡す。 */
export function starterCatalogRuntime(c: Context<Env>): StarterCatalogRuntime {
  return { bucket:c.env.IMAGES, publicBaseUrl:c.env.WORKER_URL, reportError:error=>unhandledWorkerError(error,c) };
}
