/**
 * Shipped web bundle composition: interactive preview mounts before the API
 * gateway with loopback-only defaults for remote/LAN launches.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

describe('dsh-web-app bundle composition', () => {
  it('mounts interactive preview before apiproxy with loopback defaults', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    expect(manifest.dependencies?.['@deepseek-ai/dsh-host-interactive-preview']).toBe('workspace:^')

    const parsed = yaml.load(
      readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'),
      { schema: entryListSchema },
    )
    if (!Array.isArray(parsed)) throw new TypeError('web-app patch must parse to a patch list')
    const rows = parsed.flatMap((patch): Record<string, unknown>[] =>
      typeof patch === 'object' && patch !== null
        ? (patch as { insert?: Record<string, unknown>[] }).insert ?? []
        : [],
    )
    const previewIndex = rows.findIndex(row => row.id === 'interactive-preview')
    const gatewayIndex = rows.findIndex(row => row.id === 'api-gateway')
    expect(previewIndex).toBeGreaterThanOrEqual(0)
    expect(gatewayIndex).toBeGreaterThan(previewIndex)
    const preview = rows[previewIndex]
    expect(preview).toMatchObject({
      id: 'interactive-preview',
      name: '@deepseek-ai/dsh-host-interactive-preview',
      config: {
        bindHost: '127.0.0.1',
        hostnameSuffix: 'localhost',
      },
    })
  })
})
