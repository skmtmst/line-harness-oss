import type { FeatureId } from '@line-crm/shared';
/**
 * 実装側のoff強制の在り処(#643)。
 *
 * manifest に名前を足すだけでは「本当に止まるか」は分からない。
 * `gated` は判定を書いたファイルと、そこに必ず現れる目印を持ち、
 * feature-job-manifest.test.ts が実ソースを読んで機械照合する。
 * `exempt` は外部呼び出しも状態更新もしない処理だけで、理由を必ず書く。
 */
export type FeatureJobEnforcement =
  | {
    readonly mode: 'gated';
    /** 判定を書いたファイル(リポジトリ相対)。全て存在すること。 */
    readonly sources: readonly string[];
    /** sources のどこかに必ず現れる判定の目印。全て見つかること。 */
    readonly markers: readonly string[];
  }
  | { readonly mode: 'exempt'; readonly reason: string };


export type FeatureJobMetadata = {
  name: string;
  /** delivery Cron で送信・通知を取り出す dispatcher だけに付ける。 */
  dispatchLane?: 'delivery';
  classification:
    | { kind: 'feature'; featureId: FeatureId }
    | { kind: 'core'; reason: string };
  enforcement: FeatureJobEnforcement;
};
