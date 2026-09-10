/**
 * 機能オフのアカウントをSQLの中で外すための条件式。
 *
 * D1 の型に触れないので、Workers 型を読み込まない場所(リポジトリの
 * scripts など)から辿られても壊れない。判定の正本は worker の
 * `accountFeatureIsEnabled`、db 層の写しは `isAccountFeatureEnabled`。
 */
import { featureCatalogEntry, type FeatureId } from '@line-crm/shared';

/**
 * 機能オフ中のアカウントかをSQL内で判定する条件式。
 *
 * 判定順は `isAccountFeatureEnabled` と同じ「一括設定 → 個別設定 →
 * カタログ既定値」。先に決まったところで打ち切るため、一括設定でONなら
 * 古い個別設定がOFFでもOFFにはならない。設定が無い機能は
 * カタログの既定値で決まるので、既定OFFの機能も正しくOFFになる。
 *
 * 使う側で `AND NOT (...)` の形で足す。持ち主不明(NULL)はどのEXISTSにも
 * 当たらないため、既定ONの機能では偽(=止めない)になる。
 *
 * accountColumn は必ず表名か別名で修飾すること。修飾しない列名は
 * 内側の account_settings 側の同名列として解釈され、全アカウントが
 * オフ扱いになる。取り違えを実行時に止めるため、ここで弾く。
 * featureとaccountColumnは呼び出し側の固定文字列にすること。
 */
export function accountFeatureOffExclusionSql(
  accountColumn: string,
  feature: string,
): string {
  if (!accountColumn.includes('.')) {
    throw new Error(`accountFeatureOffExclusionSql requires a qualified column: ${accountColumn}`);
  }
  // 内側の別名は外側と衝突しない名前にする。`s` などの短い別名を使うと、
  // 外側が同じ別名のときに相関条件が自分自身との比較になり常に真になる。
  const bundleRow = `FROM account_settings feature_off_row
      WHERE feature_off_row.line_account_id = ${accountColumn}
        AND feature_off_row.key = 'feature.settings_bundle_v1'
        AND json_valid(feature_off_row.value)`;
  const legacyRow = `FROM account_settings feature_off_row
      WHERE feature_off_row.line_account_id = ${accountColumn}
        AND feature_off_row.key = 'feature.${feature}'
        AND json_valid(feature_off_row.value)`;
  // 既定OFFの機能は「明示ONが無い」ことがOFF。既定ONの機能は「明示OFF」だけがOFF。
  const defaultIsOff = featureCatalogEntry(feature as FeatureId)?.defaultEnabled === false;
  return `(
    CASE
      WHEN EXISTS (SELECT 1 ${bundleRow}
        AND json_type(feature_off_row.value, '$.data.features.${feature}') IN ('true', 'false'))
      THEN EXISTS (SELECT 1 ${bundleRow}
        AND json_extract(feature_off_row.value, '$.data.features.${feature}') = 0)
      WHEN EXISTS (SELECT 1 ${legacyRow}
        AND (json_type(feature_off_row.value, '$') IN ('true', 'false')
          OR json_type(feature_off_row.value, '$.enabled') IN ('true', 'false')))
      THEN EXISTS (SELECT 1 ${legacyRow}
        AND (json_extract(feature_off_row.value, '$') = 0
          OR json_extract(feature_off_row.value, '$.enabled') = 0))
      ELSE ${defaultIsOff ? '1' : '0'}
    END
  )`;
}

