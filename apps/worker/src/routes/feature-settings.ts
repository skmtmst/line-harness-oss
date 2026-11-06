import { inputJsonBoundary } from '../lib/input-errors.js';
import { Hono } from 'hono';

import type { Env } from '../worker-env.js';
import { requireRole } from '../middleware/role-guard.js';

import { get__api_settings_features_visibility_1, get__api_settings_features_2, post__api_settings_features_impact_3, put__api_settings_features_4 } from './feature-settings-controls-handlers.js';
import { specializedCatalog, ToggleableFeature, NEN_SPECIALIZED_FEATURES } from './feature-settings-definition.js';

/**
 * 機能のオン／オフ。
 *
 * account_settings の版付き一括設定を正本にし、旧 `feature.<キー>` は
 * 保存済みデータを読むための互換経路として残す。
 */
const featureSettings = new Hono<Env>();
export { TOGGLEABLE_FEATURES } from './feature-settings-definition.js';
export type { ToggleableFeature } from './feature-settings-definition.js';
export { DEFAULT_DISABLED_FEATURES } from './feature-settings-definition.js';
export { NEN_SPECIALIZED_FEATURES } from './feature-settings-definition.js';
export { featureIsEnabled } from './feature-settings-definition.js';
export { specializedCatalog } from './feature-settings-definition.js';
export type { FeatureImpactKind } from './feature-settings-definition.js';
export type { FeatureImpactItem } from './feature-settings-definition.js';
export type { FeatureImpact } from './feature-settings-definition.js';
export type { FeatureImpactSource } from './feature-settings-definition.js';
export type { FeatureImpactItemWithIds } from './feature-settings-definition.js';
export type { FeatureImpactCoverageEntry } from './feature-settings-definition.js';
export { FEATURE_IMPACT_COVERAGE } from './feature-settings-definition.js';

/**
 * 一般staffの画面の殻専用。表示可否のboolean以外は返さず、管理GETと分離する。
 * account境界は応答を作る前に検査し、空scope・別accountを同じ403へ倒す。
 */
featureSettings.get('/api/settings/features/visibility', get__api_settings_features_visibility_1);

featureSettings.get('/api/settings/features', requireRole('owner', 'admin'), get__api_settings_features_2);

/**
 * 変更案の影響確認。保存はしない。
 *
 * 有効→無効に変わる機能ごとに公開中・予約中・依存機能の件数と対象種別を
 * 返す。止まる仕事があるときだけ確認トークンを発行し、保存時に求める。
 * 影響がなければトークンは要らない(通常保存)。
 */
featureSettings.post('/api/settings/features/impact', requireRole('owner', 'admin'), inputJsonBoundary({"features":["object"]}), post__api_settings_features_impact_3);

featureSettings.put('/api/settings/features', requireRole('owner', 'admin'), inputJsonBoundary({"features":["object"]}), put__api_settings_features_4);

export { featureSettings };
