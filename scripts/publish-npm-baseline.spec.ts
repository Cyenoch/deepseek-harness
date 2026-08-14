/** Baseline discovery must skip the named desktop host, not every private app. */
import { describe, expect, it } from 'vitest'
import { WorkspacePackageSet } from './publish-npm-baseline.ts'
import { RepositoryFixture } from './repository-fixture.ts'

const fixtures = new RepositoryFixture()

function fixture(): string {
  const root = fixtures.create('dsh-npm-baseline-')
  fixtures.writeManifest(root, 'package.json', { name: '@deepseek-ai/dsh-root', version: '1.2.3' })
  return root
}

describe('npm baseline discovery', () => {
  it('excludes only the named desktop host from staging', () => {
    const root = fixture()
    fixtures.writeManifest(root, 'apps/cli/package.json', { name: '@deepseek-ai/dsh', version: '1.2.3' })
    fixtures.writeManifest(root, 'apps/desktop/package.json', {
      name: '@deepseek-ai/dsh-desktop',
      version: '0.0.0',
      private: true,
    })
    fixtures.writeManifest(root, 'apps/other/package.json', {
      name: '@deepseek-ai/dsh-other',
      version: '1.2.3',
      private: true,
    })

    const discovered = WorkspacePackageSet.discover(root)
    expect(discovered.packages.map(pkg => pkg.name)).toEqual([
      '@deepseek-ai/dsh',
      '@deepseek-ai/dsh-other',
    ])
    expect(discovered.packages.map(pkg => pkg.directory)).not.toContain('apps/desktop')
  })
})
