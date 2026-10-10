import { BUNDLE_VERSION, GIT_COMMIT, RELEASED_AT } from '../_version.js';

/** 配備で渡す公開情報だけを選ぶ。環境変数の一覧は返さない。 */
export type BuildBindings = {
  BUILD_GIT_COMMIT?: string;
  BUILD_VERSION?: string;
  BUILD_RELEASED_AT?: string;
};

export function buildMetadata(env: BuildBindings = {}) {
  return {
    git_commit: env.BUILD_GIT_COMMIT ?? GIT_COMMIT,
    version: env.BUILD_VERSION ?? BUNDLE_VERSION,
    released_at: env.BUILD_RELEASED_AT ?? RELEASED_AT,
  };
}
