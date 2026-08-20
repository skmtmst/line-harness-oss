# Dashboard spacing and inbox links — design QA

## Comparison target

- Source visual truth:
  - `/Users/kentakenta/Pictures/Zappy/Screen Shot 2026-08-21 at 12.20.32 AM.png`
  - `/Users/kentakenta/Pictures/Zappy/Screen Shot 2026-08-21 at 12.22.35 AM.png`
  - `/Users/kentakenta/Pictures/Zappy/Screen Shot 2026-08-21 at 12.25.50 AM.png`
- Browser-rendered implementation:
  - `/Users/kentakenta/.codex/visualizations/2026/08/20/01a02033-4ebc-77d3-ab98-f2247981416b/dashboard-spacing-links/dashboard-main-1337x1085.png`
  - `/Users/kentakenta/.codex/visualizations/2026/08/20/01a02033-4ebc-77d3-ab98-f2247981416b/dashboard-spacing-links/dashboard-tooltip-1440.png`
  - `/Users/kentakenta/.codex/visualizations/2026/08/20/01a02033-4ebc-77d3-ab98-f2247981416b/dashboard-spacing-links/dashboard-1920.png`
- Combined comparison evidence:
  - `/Users/kentakenta/.codex/visualizations/2026/08/20/01a02033-4ebc-77d3-ab98-f2247981416b/dashboard-spacing-links/dashboard-source-vs-implementation.png`
  - `/Users/kentakenta/.codex/visualizations/2026/08/20/01a02033-4ebc-77d3-ab98-f2247981416b/dashboard-spacing-links/friend-trend-source-vs-implementation.png`
- State: desktop dashboard with five pending inbox rows and seven estimated friend-trend rows. A local read-only mock API supplied deterministic data; no production data was changed.

## Viewport and normalization

- Full-view source: 1337 × 1085 px.
- Full-view implementation: Chrome CSS viewport 1608 × 1085, device scale 1. The fixed 256 px sidebar was cropped, leaving the 1337 × 1085 main region used for the like-for-like comparison.
- Focused friend-trend source: 968 × 421 px.
- Focused implementation card: 929 × 370 CSS px. It was proportionally normalized to 968 × 385 and placed on a 968 × 421 canvas so the intentionally removed explanation row remains visible as reduced height rather than being stretched back in.
- Responsive checks: the page and main region had `scrollWidth === clientWidth` at both the 1440-class check and 1920 px check. No horizontal page or table overflow appeared.

## Findings

- No actionable P0, P1, or P2 differences remain.
- Fonts and typography: the trend rows now use the normal dashboard table weight and `text-ink-secondary`, removing the unusually faint appearance. Japanese dates remain in the requested `8月20日(木)` form and no longer shift by browser timezone.
- Spacing and layout rhythm: the fixed 76 px dashboard heading height is gone, the heading-to-`今日やること` gap is compact, and five 61 px inbox rows fill the card down to the pagination border without the previous blank strip.
- Colors and tokens: existing dashboard tokens are preserved. The help tooltip uses the existing ink/on-accent/control-radius tokens and keeps readable contrast.
- Image and asset fidelity: this change contains no product imagery or custom visual assets. The screenshots' orange review rectangles are annotations, not product UI, and were intentionally not recreated.
- Copy and content: the persistent explanation row was removed. The same explanation appears only when the round `?` beside `推定` is hovered or keyboard-focused.
- Affordances and accessibility: each help button has a date-specific accessible label and exposes a real tooltip on hover/focus. Names are links with descriptive titles and normal hover/focus treatment.

## Interaction verification

- Hovered `8月20日(木)の推定値について`; the tooltip became visible and displayed the complete requested explanation.
- Clicked `Kyohei Yamamoto`; navigation reached `/chats?friend=friend-1&unanswered=1`.
- Clicked `テスト 太郎`; navigation reached `/chats?channel=email&thread=thread-2`.
- A fresh final dashboard tab reported no console warnings or errors.

## Comparison history

1. Initial source review found the three user-marked issues: oversized heading space, a blank strip below the fifth inbox row, and a persistent explanation row under the trend table. The added request also required direct LINE/email inbox links.
2. First implementation removed the heading minimum height, filled the inbox card, moved the explanation into a help tooltip, and added channel-aware links. Browser QA then exposed that date labels could shift one day outside Japan and that an above-the-icon tooltip could be clipped by the table wrapper.
3. The final implementation derives the weekday from the ISO calendar date with UTC-safe arithmetic and positions the tooltip to the icon's right. The final full-view and focused comparisons show the requested spacing, type treatment, help affordance, and reduced trend-card height with no remaining P0/P1/P2 issue.

## Follow-up polish

- None required for this request.

final result: passed
