import { describe, expect, it } from 'vitest'
import {
  CENTER_MIN, clampWidth, computeColumns,
  SECONDARY_DEFAULT, SECONDARY_MIN, SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT, SIDEBAR_MIN,
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
    const cols = computeColumns(1920, open(SIDEBAR_DEFAULT), open(SECONDARY_DEFAULT))
    expect(cols).toEqual({ sidebar: 280, center: 1920 - 280 - 360, secondary: 360 })
  })

  it('closed sidebar keeps its compact rail while a closed secondary panel contributes zero width', () => {
    expect(computeColumns(1920, closed(300), closed(360)))
      .toEqual({ sidebar: SIDEBAR_COLLAPSED, center: 1920 - SIDEBAR_COLLAPSED, secondary: 0 })
  })

  it('preferences beyond the clamp range are clamped before solving', () => {
    const cols = computeColumns(1920, open(9999), open(1))
    expect(cols.sidebar).toBe(420)
    expect(cols.secondary).toBe(300)
    expect(computeColumns(1920, open(1), open(SECONDARY_DEFAULT)).sidebar).toBe(SIDEBAR_MIN)
  })

  it('step 2: secondary panel shrinks first, center pinned at min', () => {
    // 280 + 360 + 640 = 1280 > 1250; secondary concedes to 1250-280-640 = 330.
    const cols = computeColumns(1250, open(SIDEBAR_DEFAULT), open(SECONDARY_DEFAULT))
    expect(cols).toEqual({ sidebar: 280, center: CENTER_MIN, secondary: 330 })
  })

  it('boundary: exactly at the step-1/step-2 seam', () => {
    const cols = computeColumns(300 + 360 + CENTER_MIN, open(300), open(360))
    expect(cols).toEqual({ sidebar: 300, center: CENTER_MIN, secondary: 360 })
    const one = computeColumns(300 + 360 + CENTER_MIN - 1, open(300), open(360))
    expect(one).toEqual({ sidebar: 300, center: CENTER_MIN, secondary: 359 })
  })

  it('step 3: secondary panel auto-closes when its min still starves center', () => {
    // 280 + 300 + 640 = 1220 > 1210 → secondary 0; sidebar untouched: center = 1210-280 = 930.
    const cols = computeColumns(1210, open(SIDEBAR_DEFAULT), open(SECONDARY_DEFAULT))
    expect(cols).toEqual({ sidebar: 280, center: 930, secondary: 0 })
  })

  it('the sidebar never concedes: center absorbs the deficit below CENTER_MIN', () => {
    // 700 < 280+640: sidebar keeps 280, center takes 420 < CENTER_MIN.
    const cols = computeColumns(700, open(SIDEBAR_DEFAULT), closed(SECONDARY_DEFAULT))
    expect(cols).toEqual({ sidebar: SIDEBAR_DEFAULT, center: 420, secondary: 0 })
  })

  it('sidebar-closed narrow window: secondary panel concedes then auto-closes', () => {
    const fits = computeColumns(SIDEBAR_COLLAPSED + SECONDARY_MIN + CENTER_MIN, closed(300), open(SECONDARY_DEFAULT))
    expect(fits).toEqual({ sidebar: SIDEBAR_COLLAPSED, center: CENTER_MIN, secondary: SECONDARY_MIN })
    const starved = computeColumns(SIDEBAR_COLLAPSED + SECONDARY_MIN + CENTER_MIN - 1, closed(300), open(SECONDARY_DEFAULT))
    expect(starved).toEqual({
      sidebar: SIDEBAR_COLLAPSED,
      center: SECONDARY_MIN + CENTER_MIN - 1,
      secondary: 0,
    })
  })

  it('tiny viewport: secondary panel closes, sidebar holds, center takes the remainder', () => {
    const cols = computeColumns(400, open(SIDEBAR_DEFAULT), open(SECONDARY_DEFAULT))
    expect(cols.secondary).toBe(0)
    expect(cols.sidebar).toBe(SIDEBAR_DEFAULT)
    expect(cols.center).toBe(Math.max(0, 400 - SIDEBAR_DEFAULT))
  })

  it('recovery is pure: re-widening restores preferred widths untouched', () => {
    const squeezed = computeColumns(1100, open(SIDEBAR_DEFAULT), open(SECONDARY_DEFAULT))
    expect(squeezed.secondary).toBe(0)
    const restored = computeColumns(1920, open(SIDEBAR_DEFAULT), open(SECONDARY_DEFAULT))
    expect(restored.secondary).toBe(SECONDARY_DEFAULT)
    expect(restored.sidebar).toBe(SIDEBAR_DEFAULT)
  })
})

describe('computeColumns — degenerate viewports', () => {
  it('sidebar closed and viewport below CENTER_MIN: secondary panel auto-closes', () => {
    // Reaches step 3's auto-close with the compact rail sidebar.
    expect(computeColumns(500, closed(300), open(SECONDARY_DEFAULT)))
      .toEqual({ sidebar: SIDEBAR_COLLAPSED, center: 500 - SIDEBAR_COLLAPSED, secondary: 0 })
  })
})
