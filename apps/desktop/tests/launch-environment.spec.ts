import { delimiter } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  hydrateDesktopLaunchEnvironment,
  mergeExecutablePath,
  parseLoginShellEnvironment,
} from '../src/launch-environment.ts'

describe('packaged desktop launch environment', () => {
  it('parses the marked environment after arbitrary shell startup output', () => {
    expect(parseLoginShellEnvironment([
      'profile message',
      '__DSH_LOGIN_ENV_BEGIN__',
      'PATH=/opt/homebrew/bin:/usr/bin',
      'MULTILINE=first\nsecond',
      '__DSH_LOGIN_ENV_END__',
      'logout message',
    ].join('\0'))).toEqual({
      PATH: '/opt/homebrew/bin:/usr/bin',
      MULTILINE: 'first\nsecond',
    })
  })

  it('preserves inherited PATH precedence while adding shell-only directories', () => {
    expect(mergeExecutablePath(
      ['/custom/bin', '/usr/bin'].join(delimiter),
      ['/opt/homebrew/bin', '/usr/bin'].join(delimiter),
    )).toBe(['/custom/bin', '/usr/bin', '/opt/homebrew/bin'].join(delimiter))
  })

  it('hydrates missing exports and PATH without replacing explicit launch values', async () => {
    const environment = { PATH: '/usr/bin', EXISTING: 'launch' }
    const probe = vi.fn(async () => [
      '__DSH_LOGIN_ENV_BEGIN__',
      'PATH=/opt/homebrew/bin:/usr/bin',
      'EXISTING=shell',
      'SHELL_ONLY=ready',
      'DISABLE_AUTO_UPDATE=true',
      'PWD=/ignored',
      '__DSH_LOGIN_ENV_END__',
    ].join('\0'))
    await hydrateDesktopLaunchEnvironment({
      environment,
      platform: 'darwin',
      shell: '/bin/zsh',
      probe,
    })
    expect(probe).toHaveBeenCalledWith('/bin/zsh', environment)
    expect(environment).toEqual({
      PATH: ['/usr/bin', '/opt/homebrew/bin'].join(delimiter),
      EXISTING: 'launch',
      SHELL_ONLY: 'ready',
    })
  })

  it('does not start a login shell on other platforms', async () => {
    const probe = vi.fn(async () => '')
    await hydrateDesktopLaunchEnvironment({
      environment: { PATH: 'C:\\Windows\\System32' },
      platform: 'win32',
      shell: 'pwsh.exe',
      probe,
    })
    expect(probe).not.toHaveBeenCalled()
  })

  it('keeps the inherited environment when the login-shell probe fails', async () => {
    const environment = { PATH: '/usr/bin' }
    const warn = vi.fn()
    await hydrateDesktopLaunchEnvironment({
      environment,
      platform: 'darwin',
      shell: '/bin/zsh',
      probe: async () => { throw new Error('profile failed') },
      warn,
    })
    expect(environment).toEqual({ PATH: '/usr/bin' })
    expect(warn).toHaveBeenCalledOnce()
  })
})
