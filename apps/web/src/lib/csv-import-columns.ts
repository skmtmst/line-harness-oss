/** UID対応表の列名。互換の取り込み入口も同じ定義を使う。 */
export const UID_IMPORT_COLUMNS = {
  oldUid: ['old_uid', '旧uid', '移行元uid'],
  newUid: ['new_uid', '新uid', '移行先uid'],
} as const
export const UID_IMPORT_HEADERS = Object.values(UID_IMPORT_COLUMNS).map((names) => names[0])
