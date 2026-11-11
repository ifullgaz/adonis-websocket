import { test } from '@japa/runner'
import { bus } from '../src/transports/bus.js'
import { bootApp } from '../tests_helpers/boot_app.js'

type Call = { transport: string | undefined; op: string; channel: string }

function fakeManager() {
  const calls: Call[] = []
  return {
    calls,
    use(transport?: string) {
      return {
        async publish(channel: string) {
          calls.push({ transport, op: 'publish', channel })
          return true
        },
        async subscribe(channel: string) {
          calls.push({ transport, op: 'subscribe', channel })
        },
        async unsubscribe(channel: string) {
          calls.push({ transport, op: 'unsubscribe', channel })
        },
      }
    },
  }
}

test.group('bus transport', () => {
  test('with a bus, publish subscribe and unsubscribe use the default transport', async ({
    assert,
  }) => {
    const h = await bootApp()
    const manager = fakeManager()
    h.app.container.singleton('bus', () => manager)
    try {
      const transport = await bus()()
      assert.equal(transport.busPrefixedKey('orders'), 'bus:orders')
      assert.isTrue(await transport.publish('orders', { id: 1 }))
      await transport.subscribe('orders', () => {})
      await transport.unsubscribe('orders')
      assert.deepEqual(manager.calls, [
        { transport: undefined, op: 'publish', channel: 'orders' },
        { transport: undefined, op: 'subscribe', channel: 'orders' },
        { transport: undefined, op: 'unsubscribe', channel: 'orders' },
      ])
    } finally {
      await h.close()
    }
  })

  test('with a bus, a named transport is passed to use()', async ({ assert }) => {
    const h = await bootApp()
    const manager = fakeManager()
    h.app.container.singleton('bus', () => manager)
    try {
      const transport = await bus('mqtt')()
      await transport.publish('orders', { id: 1 })
      assert.deepEqual(manager.calls, [{ transport: 'mqtt', op: 'publish', channel: 'orders' }])
    } finally {
      await h.close()
    }
  })

  test('without a bus, creating the transport fails', async ({ assert }) => {
    const h = await bootApp()
    try {
      await assert.rejects(() => bus()())
    } finally {
      await h.close()
    }
  })
})
