// @vitest-environment jsdom
/**
 * createLayoutStore unit account: init shape, the action write set (clamp
 * inside actions), and localStorage persistence under `dsh.layout`. Uses the
 * test-sanctioned path: factory self-call + .create() gives the
 * real engine instance (same create path as production).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createLayoutStore } from '@deepseek-ai/dsh-client-ui-layout/src/client/stores.ts'
import {
  DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN,
  SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
  SIDEPANEL_DEFAULT, SIDEPANEL_MAX, SIDEPANEL_MIN,
} from '@deepseek-ai/dsh-client-ui-layout/src/client/columns.ts'

const PERSIST_KEY = 'dsh.layout'

beforeEach(() => { localStorage.clear() })

describe('createLayoutStore', () => {
  it('initializes the sidebar at its default width, right columns closed, wide viewport assumed', () => {
    const { store } = createLayoutStore().create()
    expect(store.getSnapshot()).toEqual({
      sidebar: SIDEBAR_DEFAULT, details: 0, sidepanel: 0, narrow: false, narrowExpanded: false,
    })
  })

  it('each create() is an independent instance while storage is empty', () => {
    const a = createLayoutStore().create()
    const b = createLayoutStore().create()
    a.actions.setSidebar(400)
    expect(b.store.getSnapshot().sidebar).toBe(SIDEBAR_DEFAULT)
  })

  it('setSidebar/setDetails/setSidepanel clamp into the contract ranges', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(1)
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_MIN)
    actions.setSidebar(9999)
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_MAX)
    actions.setDetails(1)
    expect(store.getSnapshot().details).toBe(DETAILS_MIN)
    actions.setDetails(9999)
    expect(store.getSnapshot().details).toBe(DETAILS_MAX)
    actions.setSidepanel(1)
    expect(store.getSnapshot().sidepanel).toBe(SIDEPANEL_MIN)
    actions.setSidepanel(9999)
    expect(store.getSnapshot().sidepanel).toBe(SIDEPANEL_MAX)
  })

  it('toggleSidebar flips closed <-> contract default (drag width forgotten)', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(400)
    actions.toggleSidebar()
    expect(store.getSnapshot().sidebar).toBe(0)
    actions.toggleSidebar()
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_DEFAULT)
  })

  it('narrow toggleSidebar flips only the re-expand override; the width preference survives', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(400)
    actions.setNarrow(true)
    actions.toggleSidebar()
    expect(store.getSnapshot()).toEqual({
      sidebar: 400, details: 0, sidepanel: 0, narrow: true, narrowExpanded: true,
    })
    actions.toggleSidebar()
    expect(store.getSnapshot().narrowExpanded).toBe(false)
    expect(store.getSnapshot().sidebar).toBe(400)
  })

  it('crossing the breakpoint drops the override; a same-value setNarrow keeps it', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setNarrow(true)
    actions.toggleSidebar()
    expect(store.getSnapshot().narrowExpanded).toBe(true)
    actions.setNarrow(true)
    expect(store.getSnapshot().narrowExpanded).toBe(true)
    actions.setNarrow(false)
    expect(store.getSnapshot()).toMatchObject({ narrow: false, narrowExpanded: false })
    actions.setNarrow(true)
    expect(store.getSnapshot().narrowExpanded).toBe(false)
  })

  it('openDetails uses the contract default, preserves an open width, and closeDetails zeroes', () => {
    const { store, actions } = createLayoutStore().create()
    actions.openDetails()
    expect(store.getSnapshot().details).toBe(DETAILS_DEFAULT)
    actions.setDetails(500)
    actions.openDetails()
    expect(store.getSnapshot().details).toBe(500)
    actions.closeDetails()
    expect(store.getSnapshot().details).toBe(0)
  })

  it('side panel open/close/toggle mirror the details semantics at their own range', () => {
    const { store, actions } = createLayoutStore().create()
    actions.openSidepanel()
    expect(store.getSnapshot().sidepanel).toBe(SIDEPANEL_DEFAULT)
    actions.setSidepanel(700)
    actions.toggleSidepanel()
    expect(store.getSnapshot().sidepanel).toBe(0)
    actions.toggleSidepanel()
    expect(store.getSnapshot().sidepanel).toBe(SIDEPANEL_DEFAULT)
    actions.openSidepanel()
    expect(store.getSnapshot().sidepanel).toBe(SIDEPANEL_DEFAULT)
    actions.closeSidepanel()
    expect(store.getSnapshot().sidepanel).toBe(0)
  })

  it('persists panel geometry to localStorage and restores it on a later create', () => {
    const first = createLayoutStore().create()
    first.actions.setSidebar(400)
    first.actions.openDetails()
    first.actions.setDetails(500)
    first.actions.openSidepanel()
    expect(localStorage.getItem(PERSIST_KEY)).not.toBeNull()

    const second = createLayoutStore().create()
    expect(second.store.getSnapshot()).toEqual({
      sidebar: 400, details: 500, sidepanel: SIDEPANEL_DEFAULT, narrow: false, narrowExpanded: false,
    })
  })
})
