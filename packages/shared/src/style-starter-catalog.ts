/** 統括のカタログから選ぶ初期セット。本文や店の実データは持たない。 */
export const STARTER_CATALOG_KINDS = [
  { kind: 'rich_menu', label: 'リッチメニュー', catalogType: 'rich_menu', multiple: false },
  { kind: 'template', label: 'テンプレート', catalogType: 'template', multiple: true },
  { kind: 'tag', label: 'タグ', catalogType: 'tag', multiple: true },
  { kind: 'auto_reply', label: '自動応答', catalogType: 'auto_reply', multiple: true },
  { kind: 'coupon', label: 'クーポン', catalogType: 'template', multiple: true },
  { kind: 'visit_stamp', label: '来店スタンプ', catalogType: null, multiple: false },
  { kind: 'store_info', label: 'お店の情報', catalogType: null, multiple: false },
  { kind: 'content_page', label: 'リッチメニューから開くページ', catalogType: null, multiple: true },
  { kind: 'form', label: '回答フォーム', catalogType: 'form', multiple: true },
  { kind: 'line_followup', label: 'LINE来店フォロー', catalogType: null, multiple: false },
] as const;
export type StarterCatalogKind = typeof STARTER_CATALOG_KINDS[number]['kind'];
export interface StarterCatalogSelection {
  kind: StarterCatalogKind;
  templateId: string;
  versionId: string;
}
export interface StarterCatalogDefinition {
  mode: 'catalog';
  items: [];
  selections: StarterCatalogSelection[];
}
export interface StarterCatalogOption extends StarterCatalogSelection {
  name: string;
  version: number;
}
export type StarterCatalogItemState = 'pending' | 'running' | 'succeeded' | 'blocked' | 'failed';
export interface StarterCatalogApplyResult {
  mode: 'catalog';
  items: Array<StarterCatalogSelection & { state: StarterCatalogItemState; reason: string | null }>;
}
export interface StarterCatalogDetails extends StarterCatalogOption {
  lines: Array<{ label:string; value:string }>;
  pages?: Array<{name:string;width:number;height:number;areas:Array<{label:string;destination:string;x:number;y:number;width:number;height:number}>}>;
}
