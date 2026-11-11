/*
|--------------------------------------------------------------------------
| Test app bootstrap
|--------------------------------------------------------------------------
|
| Boots a real AdonisJS 6 application with the websocket provider, a real Node
| HTTP server listening on an ephemeral port, and, when the bus is enabled, a
| mock bus factory — everything `WebSocketServer` needs to handle a real `upgrade`.
|
|   const harness = await bootApp({ bus: { channel: 'ws:test' } })
|   const client = await TestClient.connect(harness.baseUrl, '/ws/room')
|   ...
|   await harness.close()
|
| For a two-instance bus test, pass a shared broker to both boots:
|   const broker = new MockBusBroker()
|   const a = await bootApp({ broker, bus: { channel: 'ws:test' } })
|   const b = await bootApp({ broker, bus: { channel: 'ws:test' } })
|
| WHY THIS IS HAND-WIRED (and not `ignitor.httpServer().start()`):
| The AdonisJS `@adonisjs/core/services/*` proxies resolve themselves via a
| top-level `await app.booted(cb)` and read the GLOBAL app set by `createApp()`.
| The package's `src/routes/routes.ts` imports `services/router` at its top, so it
| can only be imported (a) after `createApp()` (global app exists) and (b) after
| `app.boot()` (so `app.isBooted` is true and the service's booted callback runs
| immediately instead of being queued into an already-running hook batch). That
| seam between boot and start is exactly what `httpServer().start()` hides, so we
| replicate its internals here. The ordering below mirrors `HttpServerProcess.start`
| + `Application.start`: the start callback sets the Node server BEFORE the
| provider `ready()` hook runs `webSocketServer.run()`.
*/

import { createServer, type Server as NodeServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { IgnitorFactory } from '@adonisjs/core/factories'

import { busPrefixedKey } from '@ifullgaz/adonis-bus'
import { defineConfig } from '../src/define_config.js'
import type { BusContract, WebSocketServerContract } from '../src/types/types.js'
import { MockBusBroker, type MockBus } from './mock_bus.js'

const BASE_URL = new URL('./tmp/', import.meta.url)

export interface BootOptions {
  /**
   * Run with a bus. The mock broker is installed as `bus.factory`.
   * Omit this to run without a bus.
   */
  bus?: { channel: string }
  /** Share a broker across two boots to test multi-instance fan-out. */
  broker?: MockBusBroker
  /**
   * Register routes for this app. Runs after boot, before routes are committed.
   * Receives THIS app so routes register on the app-local router (not the global
   * service proxy). Defaults to `ws/:channel` -> webSocketServer.open.
   */
  routes?: (app: any) => void | Promise<void>
}

export interface Harness {
  app: any
  baseUrl: string
  broker: MockBusBroker
  bus: MockBus
  /** The resolved package server, for white-box assertions / direct broadcast. */
  webSocketServer: WebSocketServerContract
  /** The listening Node HTTP server, for `'upgrade'` listener-count assertions. */
  nodeServer: NodeServer
  close: () => Promise<void>
}

function mockBusContract(bus: MockBus): BusContract {
  return {
    busPrefixedKey,
    async publish(channel, message) {
      await bus.publish(channel, message)
      return true
    },
    subscribe(channel, handler) {
      return bus.subscribe(channel, handler)
    },
    unsubscribe(channel) {
      return bus.unsubscribe(channel)
    },
  }
}

export async function bootApp(options: BootOptions = {}): Promise<Harness> {
  const broker = options.broker ?? new MockBusBroker()
  const bus = broker.createBus()
  const withBus = Boolean(options.bus)
  const wsConfig = defineConfig({
    bus: {
      enabled: withBus,
      channel: options.bus?.channel ?? 'websocket:broadcast',
      ...(withBus ? { factory: async () => mockBusContract(bus) } : {}),
    },
  })

  const ignitor = new IgnitorFactory()
    .withCoreConfig()
    .withCoreProviders()
    .merge({
      config: {
        websocket: wsConfig,
        // Minimal `bus` config so `busPrefixedKey()` (read by server.ts on the
        // bus-enabled path) resolves a transport + keyPrefix. The real boringbus
        // provider isn't registered here; only this lookup needs it.
        bus: { default: 'main', transports: { main: { keyPrefix: 'bus:' } } },
      },
      rcFileContents: {
        providers: [() => import('../providers/provider.js')],
      },
    })
    .create(BASE_URL, { importer: (filePath) => import(filePath) })

  // createApp() sets the global app the `@adonisjs/core/services/*` proxies read.
  const app = ignitor.createApp('web')
  await app.init()
  await app.boot() // loading the provider installs the `router.ws` macro

  // Register WS routes on THIS app's router, not the global `services/router`
  // proxy (which is captured once per process at the first boot). server.ts now
  // matches via the app-local router too (constructor-injected app), so the two
  // agree and a second boot in the same process routes correctly.
  if (options.routes) {
    await options.routes(app)
  } else {
    const router = await app.container.make('router')
    router.ws('ws/:channel', async (ctx: any) => {
      const wsServer = await app.container.make('webSocketServer')
      await wsServer.open(ctx)
    })
  }

  // Mirror HttpServerProcess.start's callback: boot+wire the HTTP server. The
  // provider's ready() hook (which calls webSocketServer.run()) runs AFTER this,
  // so the upgrade listener attaches to the server we set here.
  let nodeServer: NodeServer
  await app.start(async () => {
    const httpServer = await app.container.make('server')
    await httpServer.boot() // commits the router
    nodeServer = createServer(httpServer.handle.bind(httpServer))
    httpServer.setNodeServer(nodeServer)
    await new Promise<void>((resolve, reject) => {
      nodeServer.listen(0, '127.0.0.1')
      nodeServer.once('listening', resolve)
      nodeServer.once('error', reject)
    })
  })

  const port = (nodeServer!.address() as AddressInfo).port
  const baseUrl = `http://127.0.0.1:${port}`
  const webSocketServer = (await app.container.make('webSocketServer')) as WebSocketServerContract

  const close = async () => {
    // terminating hook -> webSocketServer.shutdown() (removes upgrade listener,
    // terminates live sockets). Then close the Node server we own.
    await app.terminate()
    if (nodeServer!.listening) {
      await new Promise<void>((resolve) => nodeServer!.close(() => resolve()))
    }
  }

  return { app, baseUrl, broker, bus, webSocketServer, nodeServer: nodeServer!, close }
}
