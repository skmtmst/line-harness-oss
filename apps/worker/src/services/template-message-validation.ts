import {
  TEMPLATE_TEXT_MAX_CHARACTERS,
  countTemplateTextCharacters,
  validateFlexMessage,
  validateImagemapMessage,
  convertBroadcastAsset,
  isBroadcastAssetKind,
} from '@line-crm/shared';

export { TEMPLATE_TEXT_MAX_CHARACTERS } from '@line-crm/shared';

export type TemplateMessageValidationResult =
  | { ok: true }
  | {
      ok: false;
      code: 'TEMPLATE_TEXT_TOO_LONG' | 'INVALID_MESSAGE';
      error: string;
      field: 'messageContent';
      maxCharacters: number;
      actualCharacters: number;
    };

/**
 * テキストテンプレートを保存する前に、Worker側でもLINEの文字数上限を確かめる。
 *
 * 画面の maxlength だけでは、別のクライアントや古い画面から上限を超えた本文を
 * 保存できる。サロゲートペアの絵文字は1文字として数える。
 */
export function validateTemplateMessage(
  messageType: string | undefined,
  messageContent: string | undefined,
  checkFlex = true,
): TemplateMessageValidationResult {
  if (messageContent !== undefined && ((checkFlex && messageType === 'flex') || messageType === 'imagemap' || isBroadcastAssetKind(messageType))) {
    let error: string | null = null;
    try {
      const parsed = JSON.parse(messageContent);
      if (messageType === 'flex') error = validateFlexMessage(parsed);
      else if (messageType === 'imagemap') error = validateImagemapMessage(parsed);
      else if (isBroadcastAssetKind(messageType)) {
        const converted = convertBroadcastAsset(messageType, parsed.assetName ?? '', parsed);
        if (!converted.ok) error = converted.error;
      }
    } catch { error = 'メッセージの中身を正しいJSON形式で入力してください'; }
    if (error) return { ok: false, code: 'INVALID_MESSAGE', error, field: 'messageContent', maxCharacters: 0, actualCharacters: 0 };
  }
  if (messageType !== 'text' || messageContent === undefined) return { ok: true };

  const actualCharacters = countTemplateTextCharacters(messageContent);
  if (actualCharacters <= TEMPLATE_TEXT_MAX_CHARACTERS) return { ok: true };

  return {
    ok: false,
    code: 'TEMPLATE_TEXT_TOO_LONG',
    error: `本文は${TEMPLATE_TEXT_MAX_CHARACTERS.toLocaleString('ja-JP')}文字までです。いまは${actualCharacters.toLocaleString('ja-JP')}文字です。`,
    field: 'messageContent',
    maxCharacters: TEMPLATE_TEXT_MAX_CHARACTERS,
    actualCharacters,
  };
}
