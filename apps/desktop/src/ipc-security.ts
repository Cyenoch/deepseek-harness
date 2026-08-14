/**
 * Pure validation for renderer-to-main desktop IPC payloads.
 * @module @deepseek-ai/dsh-desktop/ipc-security
 */
import {
  DEFAULT_MAX_REQUEST_BODY_BYTES,
  type ElectronFetchRequest,
} from '@deepseek-ai/dsh-client-connection'

const INTERNAL_ORIGIN = 'http://dsh.internal'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const EXPORT_FILENAME_PATTERN = /^dsh-session-[A-Za-z0-9_-]+\.zip$/u
const MAX_IPC_HEADERS = 32
const MAX_IPC_HEADER_BYTES = 16 * 1024

/**
 * Recognize structured-clone records, including null-prototype records.
 * @param value - untrusted IPC value.
 * @returns whether `value` is a non-array record.
 */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Validate one renderer fetch request for the internal Host authority.
 * @param value - untrusted IPC payload.
 * @returns normalized fetch request.
 */
export function parseFetchRequest(value: unknown): ElectronFetchRequest {
  if (!isPlainRecord(value)) throw new Error('desktop fetch request must be an object')
  const allowed: Record<string, true> = { id: true, url: true, method: true, headers: true, body: true }
  if (Object.keys(value).some(key => allowed[key] !== true)) {
    throw new Error('desktop fetch request contains an unknown field')
  }
  if (typeof value.id !== 'string' || !UUID_PATTERN.test(value.id)) {
    throw new Error('desktop fetch request id is invalid')
  }
  if (typeof value.url !== 'string' || typeof value.method !== 'string' || !isPlainRecord(value.headers)) {
    throw new Error('desktop fetch request fields are invalid')
  }
  const url = new URL(value.url)
  if (url.origin !== INTERNAL_ORIGIN || url.username !== '' || url.password !== '' || url.hash !== '') {
    throw new Error('desktop fetch accepts only the internal Host authority')
  }
  if (value.method !== 'GET' && value.method !== 'HEAD' && value.method !== 'POST') {
    throw new Error(`desktop fetch method ${JSON.stringify(value.method)} is not allowed`)
  }
  const headerEntries = Object.entries(value.headers)
  if (headerEntries.length > MAX_IPC_HEADERS
    || headerEntries.some(([key, item]) => typeof item !== 'string' || !/^[a-z0-9-]+$/u.test(key))
    || Buffer.byteLength(JSON.stringify(value.headers)) > MAX_IPC_HEADER_BYTES) {
    throw new Error('desktop fetch headers are invalid or too large')
  }
  if (value.body !== undefined && typeof value.body !== 'string') {
    throw new Error('desktop fetch body must be a string')
  }
  if ((value.method === 'GET' || value.method === 'HEAD') && value.body !== undefined) {
    throw new Error(`desktop fetch ${value.method} request cannot carry a body`)
  }
  if (typeof value.body === 'string' && Buffer.byteLength(value.body) > DEFAULT_MAX_REQUEST_BODY_BYTES) {
    throw new Error('desktop fetch request body is too large')
  }
  return {
    id: value.id,
    url: url.href,
    method: value.method,
    headers: Object.fromEntries(headerEntries) as Record<string, string>,
    ...(typeof value.body === 'string' ? { body: value.body } : {}),
  }
}

/**
 * Validate a renderer-requested Session export URL.
 * @param raw - untrusted IPC value.
 * @returns the internal export URL.
 */
export function parseSessionExportUrl(raw: unknown): URL {
  if (typeof raw !== 'string') throw new Error('Session export URL must be a string')
  const url = new URL(raw)
  if (url.origin !== INTERNAL_ORIGIN
    || url.pathname !== '/api/session.export'
    || url.hash !== ''
    || url.searchParams.get('sessionId') === null
    || url.searchParams.get('includeDescendants') !== 'true'
    || [...url.searchParams.keys()].some(key => key !== 'sessionId' && key !== 'includeDescendants')) {
    throw new Error('Session export URL is not allowed')
  }
  return url
}

/**
 * Validate the renderer-suggested Session export filename.
 * @param raw - untrusted IPC value.
 * @returns the accepted basename.
 */
export function parseSessionExportFilename(raw: unknown): string {
  if (typeof raw !== 'string' || !EXPORT_FILENAME_PATTERN.test(raw)) {
    throw new Error('Session export filename is invalid')
  }
  return raw
}
