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
        const parts: string[] = [];
        if (definition.card || definition.template.messageType === 'text') parts.push('本文');
        else if (definition.template.messageType === 'flex') parts.push('カード');
        else if (definition.template.messageType === 'carousel') parts.push('カルーセル');
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
