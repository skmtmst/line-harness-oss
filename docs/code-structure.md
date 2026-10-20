> 文書：コードの構成と名前｜区分：今の正本｜最終確認：2026-10-20（日本時間）

# コードの構成と名前

同じ機能の変更が近くで完結し、機能をまたぐ接続と副作用を追えるようにする。外から使う名前、URL、保存値、権限、別店舗の境界、停止、再試行の予算は、置き場の整理では変えない。見た目は [V8 の決まり](v8-design-rules.md)、動きは [段2の契約](v8-requirements/cleanup-stage2-contract.md) に従う。

## 1. 今の形を基に選んだ決まり

整理前の調査版715d55c2cでは、製品ファイルのkebab-caseは3,726/3,816、フォルダは500/503、CSS Modulesのファイルは450/459、クラスのcamelCaseは10,467/10,494だった。これは判断の根拠であり、件数や行数の凍結ではない。

| 対象 | 決まり・例 | 理由 |
|---|---|---|
| ファイル・フォルダ | `delivery-settings.tsx`、`delivery-settings/` | 多数派のkebab-caseに合わせ、大文字小文字による環境差を減らす |
| 部品 | `DeliverySettings` | JSXの標準タグと区別する |
| hook | `useDeliverySettings`、`use-delivery-settings.ts` | hookの役目が名前から分かる |
| type・interface・enum | `DeliverySettingsInput` | 値と型を区別し、入力・応答・Propsの役目を示す |
| 固定値 | `MAX_ATTEMPTS` | 実行時のインスタンスや状態のcamelCaseと区別する |
| API・DB関数 | `getBooking`、`listBookings`、`createBooking` | 動詞と対象で意味を示し、単数と一覧を混ぜない |
| 単体・操作試験 | `booking.test.ts`、`booking-cancel.test.tsx` | 対象と守る動きを示す |
| ブラウザ試験 | `booking.spec.mjs`などrunnerの収集形式 | 名前の統一で収集対象から落とさない |
| CSS Modules | `delivery-settings.module.css`、`styles.actionRow` | 現在の多数派に合わせ、用途を検索しやすくする |
| scripts | `db/`、`deploy/`、`security/`、`browser/`など役目別 | 作業回の経緯を知らなくても入口を探せる |

Nextの`page.tsx`・`route.ts`、動的URLの`[id]`・route group、設定・型宣言など道具が読む形式は維持する。URLに拡張子があるフォルダもURLの契約である。公開済みのcomponent入口と再exportの互換入口は名前を保つ。内部の型名を直しても、既存の公開型aliasは落とさない。適用済みmigration・公開export・API path・DB名・保存値・外部の機械名は、この整理の改名対象にしない。

## 2. 機能の近くに置く

```text
apps/web/src/
  app/<route>/page.tsx          URL・権限・画面をつなぐ入口
  v8/<feature>/                画面、部品、hook、純粋な関数、型、CSS、試験
    index.ts                   他の機能へ見せる名前
    <operation>/index.ts       操作単位の小さい公開入口
    README.md / BEHAVIOR.md    役目、URL指定、保存、失敗、権限
  components/shared/           複数機能の表示と操作
  components/layout/           外側、メニュー、見出し
  components/templates/        ListPage・CreatePage等の型
  lib/                         通信、認証、日時など
    api/                       transport・機能別API・型、従来の公開窓口
apps/worker/src/
  index.ts                     middlewareとrouteの順序が見える入口
  routes/                      HTTPの入口
  features/<feature>/          業務実装、型、試験、明示した公開入口
  services/                    複数機能の連携と既存の互換入口
  lib/                         通信・暗号等の基盤
  cron/                        定期処理の入口
packages/db/src/
  index.ts                     既存の公開名を明示export
  <feature>/                   SQL操作、型、試験、公開入口
packages/shared/src/           アプリをまたぐ型と純粋な契約
scripts/                       運用と検査の役目別の入口
```

1機能でしか使わない物は、その機能内に置く。小さな機能へ最初からcomponents/hooks/types/utilsの多段の箱を作らない。独立した2か所以上の製品用途があり、意味と変更理由が同じ場合だけ共通へ出す。試験、fixture、Story、再export、入口から画面への接続は2つ目の用途に数えない。権限・保存先・業務の意味が異なる物は、形が似ていても統合しない。

ブラウザ用の共有入口へNode・Worker専用の実装を混ぜず、サーバー用の入口を分ける。純粋な関数からReact・HTTP・DBの入口へ逆依存させない。

## 3. 公開入口と依存

機能の外は公開`index.ts`から必要な名前だけをimportする。内部の補助関数・hook・部品は公開しない。機能の中は実装を直接importし、自分の公開indexを読み戻さない。操作単位の小さなindexは、外から必要な名前だけを明示するために使う。アプリの機能に入口が無い場合も、内部への直接読込を許す理由にしない。packages内では公開indexを持つ業務フォルダを機能の境界とし、lib・stepsなど内部の役割分けを別の機能とは数えない。

```ts
// 公開入口
export { DeliveryList } from './list'
export type { DeliveryInput } from './delivery-types'
// 他の機能
import { DeliveryList } from '@/v8/delivery'
// 同じ機能の内部
import { buildDeliveryInput } from './delivery-model'
```

他機能から`@/v8/delivery/delivery-model`を読む形や、内部から自分の`index`へ戻る形は使わない。既存の公開subpathの互換再exportは残せるが、実装の呼ぶ側は現在の公開入口へ合わせる。`export *`で内部を丸ごと公開しない。

Nextのpage・route・layoutなどは必要な画面やhandlerへ直接つなぐ。Workerのroute登録もrouteファイルを直接importし、登録対象と順序を保つ。HTTP入口そのものを機能barrelにまとめない。Webのimportに`.js`は付けず、Worker・packagesの既存の拡張子の決まりを保つ。

`use client`とサーバー専用の実装を巨大なbarrelへ混ぜない。トップレベルで通信・登録を始めない。遅延importは公開入口へ向けても遅延のまま保つ。軽量化の成否は実ビルドと計測で確認し、indexを置いただけでは成功としない。

値の依存と型の依存、静的とliteralの動的import・require・再exportを別々に測る。循環は0にする。再帰する業務の処理があっても、実装同士を循環importさせず、公開入口が必要な呼び出し関数を内部へ渡す。自動化のタグ変更後のイベント再発火では、同じ深さ制限・キー・店舗を維持する。

## 4. 経緯を名前にしない

新しい内部名に作業番号・列車番号・revfix・旧V6/V7・板IDを混ぜない。必要なコメントは条件・権限・失敗時の扱い・伏せ方を説明する。決定番号は要件の正本文書に残し、外部の設計地図や照合ID、公開型や保存値とは区別する。現役のV8を古い版と同じ理由で消さない。

移動は`git mv`で行い、隣接試験・CSS・import・文字列で読む試験・CI・文書の入口を同時に接続する。静的参照0だけで未使用と断定しない。手動運用・復旧・外部HQ・フレームワークの自動収集も確認する。

## 5. 検査の入口

- `pnpm exec tsx scripts/structure/check.ts`：名前、公開入口を飛ばすimport、自分のbarrelへの戻り、route登録、実行時と型を含む循環を検査する。`--json`で全経路と件数を出す。
- `pnpm test:scripts`：構成の故障対照と文書の入口・参照、既存の安全検査を実行する。
- `node --test scripts/verify-no-source-visual-contracts.test.mjs`：文字を固定する試験の増殖を拒む故障対照。
- `node scripts/verify-no-source-visual-contracts.mjs --base <比較元SHA>`：Gitの改名を追跡し、既存の検査の移動と新しい固定を区別する。
- 型検査、各アプリの試験とビルド、1152・1440を含む既存の崩れ・操作・権限の検査も維持する。

構成検査は製品ソースを依存グラフにし、試験・fixtureを製品の循環へ混ぜない。試験は公開入口の利用側として直接対象を検証できる。公開互換の再exportとNextの直接接続は構造で区別し、ファイル別の新しい許可一覧、行数の凍結、数の上限は設けない。新しい違反を検出し、違反を戻せば通ることまで故障対照で確認する。

運用の台本は [scriptsの入口](../scripts/README.md)、文書全体は [文書の入口](README.md) から探す。

実行設定（`*.config.*`）同士は設定の本体を直接読む。製品の機能へ入るための中継には使わず、製品ソースへの依存は同じ公開入口の検査を受ける。
