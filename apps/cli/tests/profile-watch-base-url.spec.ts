import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { profileWatchBaseUrl } from '../src/profile-boot.ts'

describe('profileWatchBaseUrl', () => {
  it('encodes the absolute profile directory as a file URL', () => {
    const directory = resolve('profiles', 'desktop')
    const baseUrl = profileWatchBaseUrl(directory)

    expect(new URL(baseUrl).protocol).toBe('file:')
    expect(fileURLToPath(baseUrl)).toBe(directory)
  })
})
