/**
 * Shared YAML workflow load and traversal for workflow-contract specs.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'

const root = resolve(import.meta.dirname, '..')

/** Whether `value` is a non-null object map (not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Load a repository-relative YAML document as a workflow map.
 * @param path - repository-relative YAML path.
 * @throws {TypeError} when the document is not a map.
 */
export function loadWorkflow(path: string): Record<string, unknown> {
  const workflow: unknown = yaml.load(readFileSync(resolve(root, path), 'utf8'))
  if (!isRecord(workflow)) throw new TypeError(`${path} must define a workflow`)
  return workflow
}

/**
 * Read one named event block from `workflow.on`.
 * @param workflow - a document returned by {@link loadWorkflow}.
 * @param event - the `on` key to read.
 * @throws {TypeError} when the event is missing or not a map.
 */
export function workflowEvent(workflow: Record<string, unknown>, event: string): Record<string, unknown> {
  if (!isRecord(workflow.on) || !isRecord(workflow.on[event])) {
    throw new TypeError(`workflow must define the ${event} event`)
  }
  return workflow.on[event]
}

/**
 * Read one named job from `workflow.jobs`.
 * @param workflow - a document returned by {@link loadWorkflow}.
 * @param job - the job id to read.
 * @throws {TypeError} when the job is missing or not a map.
 */
export function workflowJob(workflow: Record<string, unknown>, job: string): Record<string, unknown> {
  if (!isRecord(workflow.jobs) || !isRecord(workflow.jobs[job])) {
    throw new TypeError(`workflow must define the ${job} job`)
  }
  return workflow.jobs[job]
}
