import { describe, expect, it } from 'vitest'
import {
  CENTER_MIN, clampWidth, computeColumns,
  DETAILS_DEFAULT, DETAILS_MIN, SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT, SIDEBAR_MIN,
  SIDEPANEL_DEFAULT,
} from '@deepseek-ai/dsh-client-ui-layout/src/client/columns.ts'

// Numeric preference form (0 = closed); helpers keep the scenario names readable.
const open = (width: number) => width
const closed = (_width: number) => 0

describe('clampWidth', () => {
  it('clamps into the range and rounds', () => {
    expect(clampWidth(250.4, 240, 420)).toBe(250)
    expect(clampWidth(100, 240, 420)).toBe(240)
    expect(clampWidth(9999, 240, 420)).toBe(420)
  })
})

describe('computeColumns', () => {
  it('step 1: everything fits at preferred widths', () => {
    const cols = computeColumns(1920, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT), open(SIDEPANEL_DEFAULT))
    expect(cols).toEqual({ sidebar: 280, center: 1920 - 280 - 360 - 420, details: 360, sidepanel: 420 })
  })

  it('closed sidebar keeps its compact rail while closed right columns contribute zero width', () => {
    expect(computeColumns(1920, closed(300), closed(360), closed(SIDEPANEL_DEFAULT)))
      .toEqual({ sidebar: SIDEBAR_COLLAPSED, center: 1920 - SIDEBAR_COLLAPSED, details: 0, sidepanel: 0 })
  })

  it('preferences beyond the clamp range are clamped before solving', () => {
    // 420+300+720+640 = 2080 ≤ 2600: everything fits after clamping.
    const cols = computeColumns(2600, open(9999), open(1), open(9999))
    expect(cols.sidebar).toBe(420)
    expect(cols.details).toBe(300)
    expect(cols.sidepanel).toBe(720)
    expect(computeColumns(1920, open(1), open(DETAILS_DEFAULT), closed(SIDEPANEL_DEFAULT)).sidebar).toBe(SIDEBAR_MIN)
  })

  it('step 2: details shrinks first, center pinned at min, side panel holds', () => {
    // 280 + 360 + 420 + 640 = 1700 > 1650; details concedes to 1650-280-420-640 = 310.
    const cols = computeColumns(1650, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT), open(SIDEPANEL_DEFAULT))
    expect(cols).toEqual({ sidebar: 280, center: CENTER_MIN, details: 310, sidepanel: 420 })
  })

  it('boundary: exactly at the step-1/step-2 seam', () => {
    const cols = computeColumns(300 + 360 + 420 + CENTER_MIN, open(300), open(360), open(420))
    expect(cols).toEqual({ sidebar: 300, center: CENTER_MIN, details: 360, sidepanel: 420 })
    const one = computeColumns(300 + 360 + 420 + CENTER_MIN - 1, open(300), open(360), open(420))
    expect(one).toEqual({ sidebar: 300, center: CENTER_MIN, details: 359, sidepanel: 420 })
  })

  it('step 3: details auto-closes when its min still starves center — side panel holds', () => {
    // 280 + 300 + 420 + 640 = 1640 > 1620 → details 0; side panel untouched: center = 1620-280-420 = 920.
    const cols = computeColumns(1620, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT), open(SIDEPANEL_DEFAULT))
    expect(cols).toEqual({ sidebar: 280, center: 920, details: 0, sidepanel: 420 })
  })

  it('step 4: the side panel shrinks toward its minimum after details closes', () => {
    // 280 + 420 + 640 = 1340 > 1300 → side panel concedes to 1300-280-640 = 380.
    const cols = computeColumns(1300, open(SIDEBAR_DEFAULT), closed(DETAILS_DEFAULT), open(SIDEPANEL_DEFAULT))
    expect(cols).toEqual({ sidebar: 280, center: CENTER_MIN, details: 0, sidepanel: 380 })
  })

  it('step 5: the side panel auto-closes when its min still starves center', () => {
    // 280 + 320 + 640 = 1240 > 1230 → side panel 0; center = 1230-280 = 950.
    const cols = computeColumns(1230, open(SIDEBAR_DEFAULT), closed(DETAILS_DEFAULT), open(SIDEPANEL_DEFAULT))
    expect(cols).toEqual({ sidebar: 280, center: 950, details: 0, sidepanel: 0 })
  })

  it('the sidebar never concedes: center absorbs the deficit below CENTER_MIN', () => {
    // 700 < 280+640: sidebar keeps 280, center takes 420 < CENTER_MIN.
    const cols = computeColumns(700, open(SIDEBAR_DEFAULT), closed(DETAILS_DEFAULT), closed(SIDEPANEL_DEFAULT))
    expect(cols).toEqual({ sidebar: SIDEBAR_DEFAULT, center: 420, details: 0, sidepanel: 0 })
  })

  it('sidebar-closed narrow window: details concedes then auto-closes', () => {
    const fits = computeColumns(SIDEBAR_COLLAPSED + DETAILS_MIN + CENTER_MIN, closed(300), open(DETAILS_DEFAULT), closed(SIDEPANEL_DEFAULT))
    expect(fits).toEqual({ sidebar: SIDEBAR_COLLAPSED, center: CENTER_MIN, details: DETAILS_MIN, sidepanel: 0 })
    const starved = computeColumns(
      SIDEBAR_COLLAPSED + DETAILS_MIN + CENTER_MIN - 1, closed(300), open(DETAILS_DEFAULT), closed(SIDEPANEL_DEFAULT))
    expect(starved).toEqual({
      sidebar: SIDEBAR_COLLAPSED,
      center: DETAILS_MIN + CENTER_MIN - 1,
      details: 0,
      sidepanel: 0,
    })
  })

  it('tiny viewport: both right columns close, sidebar holds, center takes the remainder', () => {
    const cols = computeColumns(400, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT), open(SIDEPANEL_DEFAULT))
    expect(cols.details).toBe(0)
    expect(cols.sidepanel).toBe(0)
    expect(cols.sidebar).toBe(SIDEBAR_DEFAULT)
    expect(cols.center).toBe(Math.max(0, 400 - SIDEBAR_DEFAULT))
  })

  it('recovery is pure: re-widening restores preferred widths untouched', () => {
    const squeezed = computeColumns(1100, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT), open(SIDEPANEL_DEFAULT))
    expect(squeezed.details).toBe(0)
    expect(squeezed.sidepanel).toBe(0)
    const restored = computeColumns(1920, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT), open(SIDEPANEL_DEFAULT))
    expect(restored.details).toBe(DETAILS_DEFAULT)
    expect(restored.sidepanel).toBe(SIDEPANEL_DEFAULT)
    expect(restored.sidebar).toBe(SIDEBAR_DEFAULT)
  })
})

describe('computeColumns — degenerate viewports', () => {
  it('sidebar closed and viewport below CENTER_MIN: right columns auto-close, center takes the rest', () => {
    // Reaches the auto-close chain with the compact rail sidebar.
    expect(computeColumns(500, closed(300), open(DETAILS_DEFAULT), open(SIDEPANEL_DEFAULT)))
      .toEqual({ sidebar: SIDEBAR_COLLAPSED, center: 500 - SIDEBAR_COLLAPSED, details: 0, sidepanel: 0 })
  })
})
