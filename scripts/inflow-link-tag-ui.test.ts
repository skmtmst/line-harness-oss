import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const page = readFileSync(
  resolve(root, 'apps/web/src/app/inflow-links/page.tsx'),
  'utf8',
);
const modal = readFileSync(
  resolve(root, 'apps/web/src/app/inflow-links/_components/edit-route-modal.tsx'),
  'utf8',
);

describe('inflow link tag auto-assignment UI wiring', () => {
  test('inflow-links page loads tags and shows the assigned auto-tag in the route list', () => {
    expect(page).toContain("import type { ApiResponse, EntryRoute, EntryRouteGenre, TrafficPool, Scenario, Tag }");
    expect(page).toContain('const [tags, setTags] = useState<Tag[]>([])');
    expect(page).toContain('api.tags.list()');
    expect(page).toContain('if (tagRes.success) setTags(tagRes.data)');
    expect(page).toContain('tagId: r.tagId');
    expect(page).toContain('const tag = tags.find((t) => t.id === r.tagId)');
    expect(page).toContain('title={tag.name}');
    expect(page).toContain('tags={tags}');
    expect(page).toContain('colSpan={12}');
  });

  test('desktop referral table stays compact without breaking identifiers mid-word', () => {
    expect(page).toContain('w-full table-fixed text-xs');
    expect(page).toContain('truncate whitespace-nowrap');
    expect(page).not.toContain('min-w-[1180px]');
    expect(page).not.toContain('font-mono text-blue-600 break-all');
  });

  test('edit route modal lets operators select a tagId that is sent with create/update payloads', () => {
    expect(modal).toContain("Tag,");
    expect(modal).toContain('tags: Tag[]');
    expect(modal).toContain('tagId: route?.tagId ?? null');
    expect(modal).toContain('自動付与タグ（任意）');
    // Combobox 配線（旧 select の書き方ではない）: 現在値・候補・「なし」表示
    expect(modal).toContain('value={form.tagId ?? \'\'}');
    expect(modal).toContain('options={tags.map((tag) => ({ value: tag.id, label: tag.name }))}');
    expect(modal).toContain('placeholder="— 設定なし —"');
    // 選んだ id が form に入り、「なし」は null になる。form ごと作成・更新で送る
    expect(modal).toContain('tagId: next || null');
    expect(modal).toContain('api.entryRoutes.create(form)');
    expect(modal).toContain('api.entryRoutes.update(route!.id, form)');
    expect(modal).toContain('友だち追加時にこのタグを自動付与します');
    expect(modal).toContain('tags.map((tag) => (');
  });
});
