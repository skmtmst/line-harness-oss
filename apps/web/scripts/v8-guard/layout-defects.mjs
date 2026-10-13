/** B-191/192: Pen と同じ崩れ判定。既存 V8 guard と同じ必須 CI。
 * node apps/web/scripts/v8-guard/layout-defects.mjs <baseUrl> [out.json]
 * --record-allow <path> --reason <理由> は手元で既存違反を採取する時だけ使う。
 * --fixtures <json> は種類別のHTMLを1つのブラウザで順に検証する。
 * --fixture <html> は対照試験用（許可リストを使わず終了コードを確かめる）。
 * --compare-url <url> は同じ検出器・API・幅で統合先も測り、新規と悪化だけを止める。
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROUTES, WIDTHS, openPage } from './browser-env.mjs'
import scanLayoutDefects from './layout-defects-browser.mjs'
import scanPendec2Rules from './pendec2-rules-browser.mjs'
import scanOwnerRules from './owner-rules-browser.mjs'
import scanPanelBlank from './panel-blank-browser.mjs'
import scanBlankGap from './blank-gap-browser.mjs'
import scanControlOverlap from './control-overlap-browser.mjs'
import scanFormRules from './form-rules-browser.mjs'
