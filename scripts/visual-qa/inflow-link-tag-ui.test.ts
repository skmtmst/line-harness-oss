import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const page = readFileSync(
  resolve(root, 'apps/web/src/v8/inflow-links/list.tsx'),
  'utf8',
);
const v8List = readFileSync(resolve(root, 'apps/web/src/v8/inflow-links/list.tsx'), 'utf8');
const rows = readFileSync(resolve(root, 'apps/web/src/v8/inflow-links/rows.ts'), 'utf8');
const listStyles = readFileSync(
  resolve(root, 'apps/web/src/v8/inflow-links/list.module.css'),
  'utf8',
);
describe('inflow link tag auto-assignment UI wiring', () => {
  test('inflow-links page loads tags and shows the assigned auto-tag in the route list', () => {
    expect(page).toContain("import type { ApiResponse, EntryRoute, EntryRouteGenre, Scenario, Tag, TrafficPool }");
    expect(page).toContain('const [tags, setTags] = useState<Tag[]>([])');
    // R23横展開: 候補は今のアカウントだけ（別アカウントの同名タグ混入防止）。
    expect(page).toContain('api.tags.list(candidateParams)');
    expect(page).toContain('if (tagRes.success && Array.isArray(tagRes.data)) setTags(tagRes.data)');
    expect(rows).toContain('tagId: r.tagId');
    expect(page).toContain('const tag = tags.find((t) => t.id === r.tagId)');
    // V8はシナリオとタグを「友だちになったら」の2行にまとめる。
    expect(page).toContain('becameLines(r, sc, tag, introTemplate?.name ?? null)');
    expect(rows).toContain('タグ「${tag.name}」');
    expect(page).toContain('title={becameSecond}>{becameSecond}');
    expect(page).toContain('tags={tags}');
  });

  test('desktop referral table stays compact without breaking identifiers mid-word', () => {
    expect(page).toContain('className={styles.tableWrap}');
    for (const cell of ['cellMain', 'cellSub']) {
      const rule = listStyles.match(new RegExp(`\\.${cell}[^{}]*\\{([^}]+)\\}`))?.[1];
      expect(rule, cell).toContain('text-overflow: ellipsis');
      expect(rule, cell).toContain('white-space: nowrap');
    }
    const truncateStyles = readFileSync(new URL('../../apps/web/src/components/shared/truncated-text.module.css', import.meta.url), 'utf8')
    expect(truncateStyles).toContain('text-overflow: ellipsis')
    expect(truncateStyles).toContain('white-space: nowrap')
    expect(page).not.toContain('title={r.refCode}')
    expect(page).toContain("label: 'URLをコピー'");
    expect(page).toContain('<CopyTextButton role="menuitem" value={referralUrl(row.refCode)}');
    expect(v8List).toContain('<FolderDotName');
    expect(page).not.toContain('min-w-[1180px]');
    expect(page).not.toContain('font-mono text-blue-600 break-all');
  });

  // 作成/更新でのタグ選択・解除の実操作は
  // apps/web/src/app/inflow-links/edit-route-modal-submit-contract.test.ts へ移した。
});
