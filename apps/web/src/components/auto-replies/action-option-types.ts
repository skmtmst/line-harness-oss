'use client'









/**
 * 応答したときに行うことの並び。
 *
 * シナリオのアクション（`scenario_actions` の行）と違い、自動応答は1つの列に
 * JSON で持つ。**中身の編集はシナリオと同じ部品（ActionConfigEditor）を使う。**
 * 種別を足したときに片方だけ増えるのを避けるため。
 */

export type Option = { id: string; name: string }
