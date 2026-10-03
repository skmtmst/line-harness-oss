import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PICKER = readFileSync(join(HERE, '..', 'components', 'DateTimePicker.tsx'), 'utf8');
const CONFIRM = readFileSync(join(HERE, '..', 'components', 'Confirm.tsx'), 'utf8');
const FORM = readFileSync(join(HERE, 'Form.tsx'), 'utf8');

/*
 * 414 幅の板（`xvtSz`・`uZqMA`・`wPfqW`）は `data-design-node` が無いと
 * 進み具合に数えられない。中身は 375 幅と同じで、板 ID だけを替える。
 * ここでは板IDの結び付けだけを見る。
 */
describe('LIFF 414 幅の板ID', () => {
  it('日時（週）が414幅で xvtSz になる', () => {
    expect(PICKER).toContain("wide ? 'xvtSz' : 'M2p63S'");
    expect(PICKER).toContain('useWideViewport()');
  });

  it('内容の確認が414幅で uZqMA になる', () => {
    expect(CONFIRM).toContain("data-design-node={wide ? 'uZqMA' : 'gLReL'}");
    expect(CONFIRM).toContain('useWideViewport()');
  });

  it('回答フォーム①が414幅で wPfqW になる', () => {
    expect(FORM).toContain("data-design-node={wide ? 'wPfqW' : 'B8rCt'}");
    expect(FORM).toContain('useWideViewport()');
  });
});
