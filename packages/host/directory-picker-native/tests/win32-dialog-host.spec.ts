import { describe, expect, it } from 'vitest'
import { dialogWorkerEnvironment } from '../src/win32-dialog-host.ts'

describe('dialogWorkerEnvironment', () => {
  it('runs the worker through Electron Node mode without mutating the ambient environment', () => {
    const ambient = { PATH: '/host/bin', ELECTRON_RUN_AS_NODE: 'operator-value' }

    expect(dialogWorkerEnvironment('Packaged picker', ambient, true)).toEqual({
      PATH: '/host/bin',
      DSH_DIALOG_TITLE: 'Packaged picker',
      ELECTRON_RUN_AS_NODE: '1',
    })
    expect(ambient).toEqual({ PATH: '/host/bin', ELECTRON_RUN_AS_NODE: 'operator-value' })
  })

  it('does not add Electron Node mode under plain Node', () => {
    expect(dialogWorkerEnvironment('Source picker', { PATH: '/host/bin' }, false)).toEqual({
      PATH: '/host/bin',
      DSH_DIALOG_TITLE: 'Source picker',
    })
  })
})
