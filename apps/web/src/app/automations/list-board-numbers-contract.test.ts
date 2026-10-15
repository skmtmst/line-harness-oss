/**
 * 現役V8一覧の数の帯と表の共通部品を確認する。
 * 旧一覧のTailwind寸法は固定せず、現役の帯のトークンを見張る。
 */
import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs';
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SHELL = readFileSync(resolve(__dirname, '../../v8/automations/shell.tsx'), 'utf-8');
const KPI_CSS = readFileSync(resolve(__dirname, '../../components/shared/kpi-card.module.css'), 'utf-8');
const LIST = readFileSync(resolve(__dirname, '../../v8/automations/list.tsx'), 'utf-8');
const TABLE_CSS = readFileSync(resolve(__dirname, '../../components/shared/table.module.css'), 'utf-8');

describe("automations 一覧の板の数字", () => {
  it("KPI見出しは共通の帯で12px・ink・粗500を使う", () => {
    expect(SHELL).toContain('<KpiBand');
    expect(SHELL).toContain('<KpiCard');
    expect(KPI_CSS).toMatch(/:root \.label \{[^}]*color: var\(--color-ink\); font-size: var\(--text-caption\); font-weight: 500/s);
  });

  it("KPI数字は現役の帯の寸法トークンと粗600を使う", () => {
    expect(SHELL).toContain('presentation="band"');
    expect(KPI_CSS).toMatch(/\.strip\[data-kpi-presentation='band'\] \.number \{[^}]*font-size: var\(--tpl-band-number-size\);[^}]*line-height: var\(--tpl-band-number-lh\)/s);
    expect(KPI_CSS).toMatch(/:root \.number \{[^}]*font-weight: 600/s);
  });

  it("KPI内側は現役の帯の余白トークンを使う", () => {
    expect(KPI_CSS).toMatch(/:root \.strip \.card \{[^}]*gap: var\(--tpl-band-cell-gap\); padding: var\(--tpl-band-cell-pad-block\) var\(--tpl-band-cell-pad-side\)/s);
  });

  it("V8表の見出しは共通Thで左右24・上下12・secondary・地table-headを使う", () => {
    expect(LIST).toMatch(/<TableHeadRow\b/);
    expect(LIST).toMatch(/<Th[^>]*>\{selection\}ルール<\/Th>/);
    expect(TABLE_CSS).toMatch(/:root \.headRow \{[^}]*background: var\(--color-table-head\)/s);
    expect(TABLE_CSS).toMatch(/:root \.headRow \.cell \{[^}]*padding:\s*var\(--tpl-thead-pad-block\) var\(--tpl-thead-pad-side\)[^}]*color: var\(--color-ink-secondary\)/s);
  });
});
