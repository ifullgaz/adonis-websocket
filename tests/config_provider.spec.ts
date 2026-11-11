import { test } from '@japa/runner'
import { defineConfig } from '../src/define_config.js'
import { bootApp } from '../tests_helpers/boot_app.js'

test.group('provider & config', () => {
  test('AC-7.x defineConfig round-trips the {bus:{enabled,channel}} shape', ({ assert }) => {
    const cfg = defineConfig({ bus: { enabled: true, channel: 'ws:test' } })
    assert.deepEqual(cfg, { bus: { enabled: true, channel: 'ws:test' } })
  })

  test('AC-7.x loading the provider installs the ws macro', async ({ assert }) => {
    const h = await bootApp()
    try {
      const router = await h.app.container.make('router')
      assert.isFunction((router as any).ws)

      await import('../providers/provider.js')
      assert.isFunction((router as any).ws)
    } finally {
      await h.close()
    }
  })

  /**
   * OQ-3 resolved -> bus is OFF by default (opt-in). `configure.ts` was changed to
   * seed `WEBSOCKET_ENABLED: false`, matching `config.stub`'s `env.get(..., false)`
   * default, so the generated config no longer disagrees with itself. This pins the
   * disabled-by-default contract; the codemod seed itself isn't runnable here.
   */
  test('OQ-3 bus is disabled by default (opt-in)', async ({ assert }) => {
    const h = await bootApp()
    try {
      const cfg = h.app.config.get('websocket') as { bus: { enabled: boolean } }
      assert.isFalse(cfg.bus.enabled)
    } finally {
      await h.close()
    }
  })
})
