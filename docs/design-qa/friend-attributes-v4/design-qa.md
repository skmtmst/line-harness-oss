# Friend attributes V4 design QA

## Target

- `/tags`
- `/tags/new`
- `/tags/edit?id=`
- `/tags/folders/new`

## Pen.dev references

| State | Node | Reference | Chrome implementation |
|---|---|---|---|
| List | `xn98K` | `docs/design-reference/friend-attributes-v4/01-list.png/xn98K.png` | `docs/design-qa/friend-attributes-v4/01-list.png` |
| Create / initial | `wdLjf` | `docs/design-reference/friend-attributes-v4/02-create-initial.png/wdLjf.png` | `docs/design-qa/friend-attributes-v4/02-create-initial.png` |
| Create / linked | `KYG39` | `docs/design-reference/friend-attributes-v4/03-create-linked.png/KYG39.png` | `docs/design-qa/friend-attributes-v4/03-create-linked.png` |
| Action drawer | `X79IHW` | `docs/design-reference/friend-attributes-v4/04-action-drawer.png/X79IHW.png` | `docs/design-qa/friend-attributes-v4/04-action-drawer.png` |
| Edit | `t7Mhgl` | `docs/design-reference/friend-attributes-v4/05-edit-existing.png/t7Mhgl.png` | `docs/design-qa/friend-attributes-v4/05-edit-existing.png` |
| Retroactive dialog | `lNGcs` | `docs/design-reference/friend-attributes-v4/06-retroactive-dialog.png/lNGcs.png` | `docs/design-qa/friend-attributes-v4/06-retroactive-dialog.png` |
| Delete dialog | `NU4N2` | `docs/design-reference/friend-attributes-v4/07-delete-dialog.png/NU4N2.png` | `docs/design-qa/friend-attributes-v4/07-delete-dialog.png` |
| Folder editor | `FORVU` | `docs/design-reference/friend-attributes-v4/08-folder-dialog.png/FORVU.png` | `docs/design-qa/friend-attributes-v4/08-folder-dialog.png` |

## Checks

- [x] Common V4 sidebar, spacing, font, color, radius and 1px right/down card shadow
- [x] List, filters, 20/30/40/50 rows and bounded pagination
- [x] Create initial and linked states
- [x] Miles, referral miles, multiplier, priority and re-apply behavior
- [x] Action drawer with 13 action types and timing controls
- [x] Edit and non-reversible retroactive confirmation
- [x] Custom delete confirmation and folder color editor
- [x] 1920px visual comparison after fixes
- [x] 1440px no-horizontal-scroll check
- [x] 432 tests, typecheck and production build

final result: passed
