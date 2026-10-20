'use client'

import { AreaProperties } from '@/components/rich-menus/area-properties'
import { CanvasEditor, areaDisplayName } from '@/components/rich-menus/canvas-editor'
import { type Area } from '../../../components/rich-menus/area-types'
import { NEW_MENU_INTENTS_WITH_SWITCH } from '../../../components/rich-menus/rich-menu-create-model'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import { SaveErrorField } from '@/components/shared/save-form-errors'
import SectionHeader from '@/components/shared/section-header'
import SegmentedControl from '@/components/shared/segmented'
import TapAreaEditor from '@/components/shared/tap-area-editor'
import { HQ_RICH_MENU_INTENTS } from '@/lib/hq-rich-menu-create'
import type { RichMenuCreateHost } from '@/lib/rich-menu-create-host'
import { useFormErrors } from '@/lib/use-form-errors'
import type { Dispatch,SetStateAction } from 'react'
import { type StepKey } from './create-options'
import { type Group,type Page } from './create-types'
import styles from '../../../app/rich-menus/new/create-v8.module.css'

type RenderButtonsStepContext = {
  activePage: Page
  addArea: (pageId: string, area: Area) => void
  areaActionSummary: (area: Area) => string
  deleteArea: (pageId: string, areaId: string) => void
  fields: ReturnType<typeof useFormErrors>
  forms: { id: string; name: string; folderId?: string | null; updatedAt?: string | null; }[]
  goToStep: (key: StepKey) => void
  group: Group | null
  host: RichMenuCreateHost | undefined
  pageImageUrl: string | null
  pages: Page[]
  selectedArea: Area | null
  selectedAreaId: string | null
  setActivePageId: Dispatch<SetStateAction<string | null>>
  setSelectedAreaId: Dispatch<SetStateAction<string | null>>
  size: "large" | "compact"
  tags: { id: string; name: string; }[]
  templates: { id: string; name: string; }[]
  trackedLinks: { id: string; name: string; }[]
  updateArea: (pageId: string, areaId: string, patch: Partial<Area>) => void
}

export function renderButtonsStep({ activePage, addArea, areaActionSummary, deleteArea, fields, forms, goToStep, group, host, pageImageUrl, pages, selectedArea, selectedAreaId, setActivePageId, setSelectedAreaId, size, tags, templates, trackedLinks, updateArea }: RenderButtonsStepContext) {
    if (!activePage) return <div className={styles.stateCard}>ページがありません</div>
    const activeIndex = activePage.areas.findIndex((a) => a.id === selectedAreaId)
    const areaPages = pages
      .filter((p) => host || !p.id.startsWith('tmp-'))
      .map((p) => ({ id: p.id, name: p.name }))

    /*
     * 採用案 K6Ot7O：切替タブは①で決め、②は「直すタブ」の切り替えだけ（タブがないときは出さない）。
     * 採用案 Wmch0：画像（幅 320）を左、面の一覧を右、その下に選んだ面の動き（共通部品 TapAreaEditor）。
     */
    const tabSwitch = pages.length > 1 ? (
      <div className={styles.tabSwitchRow}>
        <span className={styles.segLabel}>直すタブ</span>
        <SaveErrorField names={["id","activePage.id","activePageId"]}><SegmentedControl
          aria-label="直すタブ"
          size="compact"
          options={pages.map((p, i) => ({ value: p.id, label: `タブ${i + 1}「${p.name}」` }))}
          value={activePage.id}
          onChange={(id) => {
            setActivePageId(id)
            setSelectedAreaId(pages.find((p) => p.id === id)?.areas[0]?.id ?? null)
          }}
        /></SaveErrorField>
        <Button type="button" variant="text" className={styles.tabSwitchLink} onClick={() => goToStep('shape')}>
          タブの数・名前・画像は ①形と画像 で変えます
        </Button>
      </div>
    ) : null

    return (
      <TapAreaEditor
        head={tabSwitch}
        description="面を押すと、下に動きを決める欄が出ます。線を動かして区切り直せます"
        items={activePage.areas.map((area, i) => ({
          id: area.id,
          name: areaDisplayName(area, i),
          summary: areaActionSummary(area) || null,
          errorCount: fields.countIn(`area-${area.id}`),
        }))}
        selectedId={selectedAreaId}
        onSelect={setSelectedAreaId}
        emptyNote="画像の上をドラッグすると、面を足せます。"
        canvas={
          <CanvasEditor
            appearance="v8"
            showAreaList={false}
            showTools
            showZoom={false}
            maxWidth={320}
            areas={activePage.areas}
            size={group?.size ?? size}
            imageUrl={pageImageUrl}
            selectedAreaId={selectedAreaId}
            onSelectArea={setSelectedAreaId}
            onAddArea={(area) => addArea(activePage.id, area)}
            onUpdateArea={(id, patch) => updateArea(activePage.id, id, patch)}
            onDeleteArea={(id) => deleteArea(activePage.id, id)}
          />
        }
        detail={
          selectedArea && activeIndex >= 0 ? (
            <div {...fields.bind(`area-${selectedArea.id}`)}>
            <Card padding="roomy" layout="vertical">
              <SectionHeader title={`面 ${String.fromCharCode(65 + activeIndex)}「${areaDisplayName(selectedArea, activeIndex)}」の動き`} />
              <AreaProperties
                area={selectedArea}
                pages={areaPages}
                tags={tags}
                templates={templates}
                forms={forms}
                trackedLinks={trackedLinks}
                taps={null}
                onUpdate={(patch) => updateArea(activePage.id, selectedArea.id, patch)}
                onDelete={() => deleteArea(activePage.id, selectedArea.id)}
                showManagementDetails={false}
                allowedIntents={host ? [...HQ_RICH_MENU_INTENTS] : NEW_MENU_INTENTS_WITH_SWITCH}
                error={fields.error(`area-${selectedArea.id}`)}
              />
              <div>
                <Button type="button" variant="text" onClick={() => deleteArea(activePage.id, selectedArea.id)}>
                  この面を消す
                </Button>
              </div>
            </Card>
            </div>
          ) : (
            <Card padding="roomy" layout="vertical">
              <p className={styles.cardNote}>上の画像で面を押すと、ここで動きを決められます。</p>
            </Card>
          )
        }
      />
    )
  }
