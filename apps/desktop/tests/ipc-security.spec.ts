import { DEFAULT_MAX_REQUEST_BODY_BYTES } from '@deepseek-ai/dsh-client-connection'
import { describe, expect, it } from 'vitest'
import {
  isPlainRecord,
  parseFetchRequest,
  parseSessionExportFilename,
  parseSessionExportUrl,
} from '../src/ipc-security.ts'

const requestId = 'd9428888-122b-4c67-9462-df295d80888c'

function fetchRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: requestId,
    url: 'http://dsh.internal/api/session.list',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    ...overrides,
  }
}

describe('desktop IPC validation', () => {
  it('accepts structured-clone records and normalizes the internal URL', () => {
    const headers = Object.assign(Object.create(null) as Record<string, string>, { accept: 'application/json' })
    const value = Object.assign(Object.create(null) as Record<string, unknown>, fetchRequest({ headers }))

    expect(isPlainRecord(value)).toBe(true)
    expect(parseFetchRequest(value)).toEqual({
      id: requestId,
      url: 'http://dsh.internal/api/session.list',
      method: 'POST',
      headers: { accept: 'application/json' },
      body: '{}',
    })
  })

  it.each([
    fetchRequest({ url: 'https://example.com/api/session.list' }),
    fetchRequest({ url: 'http://dsh.internal@evil.example/api/session.list' }),
    fetchRequest({ url: 'http://dsh.internal/api/session.list#fragment' }),
    fetchRequest({ method: 'DELETE' }),
    fetchRequest({ method: 'GET', body: '' }),
    fetchRequest({ headers: { Authorization: 'secret' } }),
    fetchRequest({ extra: true }),
  ])('rejects fetch authority expansion %#', (value) => {
    expect(() => parseFetchRequest(value)).toThrow()
  })

  it('bounds request bodies before Host dispatch', () => {
    expect(() => parseFetchRequest(fetchRequest({ body: 'x'.repeat(DEFAULT_MAX_REQUEST_BODY_BYTES + 1) })))
      .toThrow('desktop fetch request body is too large')
  })

  it('accepts only the exact internal Session export operation', () => {
    expect(parseSessionExportUrl('http://dsh.internal/api/session.export?sessionId=s1&includeDescendants=true').href)
      .toBe('http://dsh.internal/api/session.export?sessionId=s1&includeDescendants=true')
    expect(parseSessionExportFilename('dsh-session-s1.zip')).toBe('dsh-session-s1.zip')

    expect(() => parseSessionExportUrl('http://dsh.internal/api/session.export?sessionId=s1'))
      .toThrow('Session export URL is not allowed')
    expect(() => parseSessionExportUrl('http://dsh.internal/api/session.export?sessionId=s1&includeDescendants=true&extra=1'))
      .toThrow('Session export URL is not allowed')
    expect(() => parseSessionExportFilename('../dsh-session-s1.zip'))
      .toThrow('Session export filename is invalid')
  })
})
