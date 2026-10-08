import type { HqMessageCard } from './hq-message-card';
import type { BroadcastAssetKind, AssetPayloadInput } from './broadcast-asset-conversion';

/** 店と統括で使うテンプレートの内容と、配布するメディアの共通契約。 */
export type MessageTemplateMediaDefinition = Readonly<{
  id: string;
  kind: 'image' | 'video' | 'audio' | 'file';
  filename: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  r2Key: string;
  publicUrl: string | null;
  versionId: string;
  versionNo: number;
  contentHash: string;
}>;

export type MessageTemplateDefinition = Readonly<{
  card?: HqMessageCard;
  /** 店の素材と同じkind/payload。メッセージ・質問はtemplateを使う。 */
  asset?: Readonly<{ kind: BroadcastAssetKind; payload: AssetPayloadInput }>;
  schemaVersion: 1;
  template: Readonly<{
    id: string;
    name: string;
    category: string;
    messageType: 'text' | 'image' | 'flex' | 'carousel';
    messageContent: string;
    carouselActionsJson: string | null;
    carouselTapLimitMode: 'none' | 'once';
    carouselTapLimitText: string | null;
    questionJson: string | null;
    questionStatus: 'draft' | 'published';
  }>;
  media: readonly MessageTemplateMediaDefinition[];
}>;


export const TEMPLATE_KINDS = ['message','carousel','rich_message','question','coupon','research'] as const;
export type TemplateKind = typeof TEMPLATE_KINDS[number];
export function templateKind(definition: MessageTemplateDefinition): TemplateKind {
  if (definition.asset) return definition.asset.kind==='card_message' ? 'carousel' : definition.asset.kind;
  if (definition.template.questionJson) return 'question';
  return definition.template.messageType==='carousel' ? 'carousel' : 'message';
}
export type TemplateKindCounts = Record<TemplateKind,number>;

export interface TemplateImagemapUpload { media: MessageTemplateMediaDefinition[]; payload: AssetPayloadInput }
