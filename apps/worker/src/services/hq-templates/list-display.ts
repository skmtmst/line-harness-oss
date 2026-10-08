import { parseFriendFieldDefinition, parseMarkDefinition } from './friend-attributes.js';
import type { HqTemplateType } from '@line-crm/db';
import { parseTagDefinition } from './tag.js';
import { parseMessageTemplateDefinition, referencedMedia } from './template.js';
import { parseRichMenuTemplateDefinition } from './rich-menu.js';
import { parseFormTemplateDefinition } from './form.js';
import { parseScenarioDefinition } from './scenario.js';

/** 本文や名前は使わず、保存された最新の内容の種類・件数だけを要約する。 */
export function templateContentSummary(type: HqTemplateType, definitionJson: string | null, tenantId: string): string | null {
  if (!definitionJson) return null;
  try {
    const input = { templateVersionId: 'list', definitionJson };
    switch (type) {
      case 'friend_field':
        return `友だち情報欄・${({text:'テキスト',textarea:'複数行',number:'数値',date:'日付',datetime:'日時',time:'時刻',select:'単一選択',multi_select:'複数選択',checkbox:'チェック',url:'URL',tel:'電話番号',email:'メール',image:'画像',pdf:'PDF'} as const)[parseFriendFieldDefinition(JSON.parse(definitionJson)).field.type]}`;
      case 'mark':
        parseMarkDefinition(JSON.parse(definitionJson));
        return '対応マーク 1';
      case 'tag':
        // 現在のひな形は主タグ1件。付属フォルダはタグ数に含めない。
        parseTagDefinition(JSON.parse(definitionJson));
        return 'タグ 1';
      case 'form':
        return `質問 ${parseFormTemplateDefinition(input).form.fields.length}`;
      case 'scenario':
        return `ステップ ${parseScenarioDefinition(JSON.parse(definitionJson)).steps.length}`;
      case 'rich_menu': {
        const menu = parseRichMenuTemplateDefinition(input, tenantId).richMenu;
        const page = menu.pages.find(p => p.id === menu.defaultPageId)!;
        return `${page.areas.length}分割・画像あり${menu.pages.length > 1 ? `・ページ ${menu.pages.length}` : ''}`;
      }
      case 'template': {
        const definition = parseMessageTemplateDefinition(JSON.parse(definitionJson));
        if(definition.asset) {
          const {kind,payload}=definition.asset;
          if(kind==='card_message') return `カード ${Array.isArray(payload.cards)?payload.cards.length:0}枚`;
          if(kind==='rich_message') return `画像・面 ${Array.isArray(payload.tapAreas)?payload.tapAreas.length:0}`;
          if(kind==='coupon') {
            const date=String(payload.endsAt??'').match(/^\d{4}-(\d{2})-(\d{2})/);
            return date ? `期限 ${Number(date[1])}/${date[2]}` : null;
          }
          return Array.isArray(payload.questions) ? `質問 ${payload.questions.length}` : null;
        }
        if(definition.template.questionJson) {
          const q=JSON.parse(definition.template.questionJson);
          return Array.isArray(q.choices)?`選択肢 ${q.choices.length}`:null;
        }
        if(definition.template.messageType==='carousel') {
          const panels=JSON.parse(definition.template.messageContent);
          return Array.isArray(panels)?`カード ${panels.length}枚`:'カルーセル';
        }
        const parts: string[] = [];
        if (definition.card || definition.template.messageType === 'text') parts.push('本文');
        else if (definition.template.messageType === 'flex') parts.push('カード');
        const media = referencedMedia(definition);
        for (const [kind, label] of [['image', '画像'], ['video', '動画'], ['audio', '音声'], ['file', 'ファイル']] as const) {
          const count = media.filter(item => item.kind === kind).length;
          if (count) parts.push(`${label} ${count}`);
        }
        return parts.join('・') || '画像';
      }
    }
  } catch {
    // 旧記録・壊れた内容を架空の件数で埋めず、他の行の一覧は返す。
    return null;
  }
}
