import type { Context } from 'hono';
import type { Env } from '../worker-env.js';
import { unhandledWorkerError } from '../lib/unhandled-error.js';
import type { StarterCatalogRuntime } from '../services/style-starter-catalog-apply.js';

/** 初期セットの投入失敗を、共通のエラー記録へ渡す。 */
export function starterCatalogRuntime(c: Context<Env>): StarterCatalogRuntime {
  return { bucket:c.env.IMAGES, publicBaseUrl:c.env.WORKER_URL, reportError:error=>unhandledWorkerError(error,c) };
}
