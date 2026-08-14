import { describe, expect, it } from 'vitest'
import { isRecord, loadWorkflow } from './workflow-spec.ts'

const validationWorkflows = [
  {
    path: '.github/workflows/release.yml',
    jobs: ['pack'],
    required: ['release:verify --family dsh', 'release:verify-packed-install --family dsh'],
  },
  {
    path: '.github/workflows/release-vendor.yml',
    jobs: ['pack'],
    required: ['release:verify --family vendor', 'release:verify-packed-install --family vendor'],
  },
  {
    path: '.github/workflows/landlock-run-release.yml',
    jobs: ['build-prebuilds', 'matrix', 'pack'],
    required: ['verify-release.mjs --prebuilds', 'verify-packed-install.mjs'],
  },
  {
    path: '.github/workflows/python-release.yml',
    jobs: ['build', 'python-compat', 'validate'],
    required: ['python -m twine check', 'sha256sum *.whl'],
  },
  {
    path: '.github/workflows/docs-pages.yml',
    jobs: ['build'],
    required: ['pnpm run doc-sync'],
  },
] as const

const forbiddenPublicationFragments = [
  '"publish"',
  'NPM_TOKEN',
  'NODE_AUTH_TOKEN',
  'registry.npmjs.org',
  'release:publish',
  'publish-release.mjs',
  'gh-action-pypi-publish',
  'upload-pages-artifact',
  'deploy-pages',
  '"id-token":"write"',
  '"pages":"write"',
] as const

describe('GitHub publication policy', () => {
  it.each(validationWorkflows)('$path keeps validation without publication authority', ({ path, jobs, required }) => {
    const workflow = loadWorkflow(path)
    if (!isRecord(workflow.jobs)) throw new TypeError(`${path} must define jobs`)

    expect(Object.keys(workflow.jobs).sort()).toEqual(jobs)
    const serialized = JSON.stringify(workflow)
    for (const fragment of required) expect(serialized).toContain(fragment)
    for (const fragment of forbiddenPublicationFragments) expect(serialized).not.toContain(fragment)
  })
})
