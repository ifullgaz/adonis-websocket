import { test } from '@japa/runner'
import { bootApp, type Harness } from '../tests_helpers/boot_app.js'
import { HandshakeError, TestClient } from '../tests_helpers/ws_client.js'

function channels(h: Harness): Map<string, Map<string, any>> {
  return (h.webSocketServer as any).channels
}

async function until(fn: () => boolean, timeout = 1000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error('until: timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

/** Register `ws/:channel` on THIS app's router with the given middleware + handler. */
function wsRouteWith(middleware: any[], handler: any) {
  return async (app: any) => {
    const router = await app.container.make('router')
    const route = (router as any).ws('ws/:channel', handler)
    route.use(middleware)
  }
}

test.group('middleware pipeline', () => {
  test('AC-1.x inline middleware runs before the handler', async ({ assert }) => {
    const order: string[] = []
    const h = await bootApp({
      routes: wsRouteWith(
        [
          (_ctx: any, next: any) => {
            order.push('mw')
            return next()
          },
        ],
        () => order.push('handler')
      ),
    })
    try {
      await TestClient.connect(h.baseUrl, '/ws/room')
      await until(() => order.length === 2)
      assert.deepEqual(order, ['mw', 'handler'])
    } finally {
      await h.close()
    }
  })

  test('AC-6.x object (class-style) middleware is dispatched via .handle', async ({ assert }) => {
    const order: string[] = []
    const classMw = {
      name: 'rec',
      args: undefined,
      handle: async (_resolver: any, _ctx: any, next: any) => {
        order.push('classmw')
        return next()
      },
    }
    const h = await bootApp({
      routes: wsRouteWith([classMw as any], () => order.push('handler')),
    })
    try {
      await TestClient.connect(h.baseUrl, '/ws/room')
      await until(() => order.length === 2)
      assert.deepEqual(order, ['classmw', 'handler'])
    } finally {
      await h.close()
    }
  })

  test('AC-2.3 middleware throwing {status:403} aborts the handshake with 403 and never registers the socket', async ({
    assert,
  }) => {
    const h = await bootApp({
      routes: wsRouteWith(
        [
          () => {
            throw Object.assign(new Error('boom'), { status: 403 })
          },
        ],
        () => {}
      ),
    })
    try {
      const error = await TestClient.connect(h.baseUrl, '/ws/room').then(
        () => undefined,
        (e) => e
      )
      assert.instanceOf(error, HandshakeError)
      assert.equal(error.status, 403)
      assert.equal(error.body, 'boom')
      // Middleware runs before the upgrade, so nothing was ever registered
      assert.equal(channels(h).get('/ws/room')?.size ?? 0, 0)
    } finally {
      await h.close()
    }
  })

  test('OQ-1 middleware throwing without a status aborts the handshake with 500', async ({
    assert,
  }) => {
    const h = await bootApp({
      routes: wsRouteWith(
        [
          () => {
            throw new Error('no status')
          },
        ],
        () => {}
      ),
    })
    try {
      const error = await TestClient.connect(h.baseUrl, '/ws/room').then(
        () => undefined,
        (e) => e
      )
      assert.instanceOf(error, HandshakeError)
      assert.equal(error.status, 500) // error.status ?? 500
      assert.equal(error.body, 'no status')
    } finally {
      await h.close()
    }
  })
  test('OQ-1b middleware throwing a non-HTTP status aborts the handshake with 500', async ({
    assert,
  }) => {
    const h = await bootApp({
      routes: wsRouteWith(
        [
          () => {
            throw Object.assign(new Error('boom'), { status: 3 })
          },
        ],
        () => {}
      ),
    })
    try {
      const error = await TestClient.connect(h.baseUrl, '/ws/room').then(
        () => undefined,
        (e) => e
      )
      assert.instanceOf(error, HandshakeError)
      assert.equal(error.status, 500) // 3 is not a valid HTTP status line
      assert.equal(error.body, 'boom')
    } finally {
      await h.close()
    }
  })
})
/**
 * Controller handlers: `router.ws(pattern, [Controller, 'method'])` and the
 * lazy-import form. AdonisJS stores these as `{ reference, handle }`; the
 * server wraps `handle` so the controller is resolved from the container and
 * the method is invoked AFTER the upgrade with the websocket context, exactly
 * like a function handler.
 */
test.group('controller handlers', () => {
  test('controller-array handler runs after the upgrade with the websocket context', async ({
    assert,
  }) => {
    const seen: any[] = []
    class Ctrl {
      open(ctx: any) {
        seen.push(ctx)
      }
    }
    const h = await bootApp({
      routes: wsRouteWith([], [Ctrl, 'open']),
    })
    try {
      const a = await TestClient.connect(h.baseUrl, '/ws/room')
      await until(() => seen.length === 1)
      assert.isOk(seen[0].ws, 'ctx.ws is attached')
      assert.isFunction(seen[0].ws.broadcast)
      assert.equal(seen[0].params.channel, 'room')
      assert.equal(channels(h).get('/ws/room')?.size, 1)
      await a.close()
    } finally {
      await h.close()
    }
  })

  test('lazy-import controller handler is resolved and invoked', async ({ assert }) => {
    const seen: any[] = []
    class Ctrl {
      open(ctx: any) {
        seen.push(ctx)
      }
    }
    const h = await bootApp({
      routes: wsRouteWith([], [async () => ({ default: Ctrl }), 'open']),
    })
    try {
      const a = await TestClient.connect(h.baseUrl, '/ws/room')
      await until(() => seen.length === 1)
      assert.isOk(seen[0].ws)
      await a.close()
    } finally {
      await h.close()
    }
  })

  test('controller method defaults to `handle` when omitted', async ({ assert }) => {
    const seen: any[] = []
    class Ctrl {
      handle(ctx: any) {
        seen.push(ctx)
      }
    }
    const h = await bootApp({
      routes: wsRouteWith([], [Ctrl]),
    })
    try {
      const a = await TestClient.connect(h.baseUrl, '/ws/room')
      await until(() => seen.length === 1)
      assert.isOk(seen[0].ws)
      await a.close()
    } finally {
      await h.close()
    }
  })

  test('middleware runs before the controller, and before the upgrade', async ({ assert }) => {
    const order: string[] = []
    class Ctrl {
      open(ctx: any) {
        order.push(ctx.ws ? 'ctrl:ws' : 'ctrl:no-ws')
      }
    }
    const h = await bootApp({
      routes: wsRouteWith(
        [
          (ctx: any, next: any) => {
            order.push(ctx.ws ? 'mw:ws' : 'mw:no-ws')
            return next()
          },
        ],
        [Ctrl, 'open']
      ),
    })
    try {
      const a = await TestClient.connect(h.baseUrl, '/ws/room')
      await until(() => order.length === 2)
      assert.deepEqual(order, ['mw:no-ws', 'ctrl:ws'])
      await a.close()
    } finally {
      await h.close()
    }
  })

  test('controller throwing {status} after the upgrade closes with 4000 + status and prunes the socket', async ({
    assert,
  }) => {
    class Ctrl {
      open() {
        throw Object.assign(new Error('nope'), { status: 409 })
      }
    }
    const h = await bootApp({
      routes: wsRouteWith([], [Ctrl, 'open']),
    })
    try {
      const a = await TestClient.connect(h.baseUrl, '/ws/room')
      const { code, reason } = await a.waitClose()
      assert.equal(code, 4409)
      assert.equal(reason, 'nope')
      await until(() => (channels(h).get('/ws/room')?.size ?? 0) === 0)
    } finally {
      await h.close()
    }
  })
})
