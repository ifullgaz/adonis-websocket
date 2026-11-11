# Adonis WebSocket

`@ifullgaz/adonis-websocket` is an AdonisJS integration that adds a
WebSocket server with route helpers and optional bus-backed broadcast support.

It integrates with:

- `@adonisjs/core`
- `@ifullgaz/adonis-bus`
- `ws`

## Installation

```bash
npm install @ifullgaz/adonis-websocket @ifullgaz/adonis-bus
node ace configure @ifullgaz/adonis-websocket
```

The configure command will:

- register provider `@ifullgaz/adonis-websocket/websocket_provider`
- create `config/websocket.ts`
- define env variables:
  - `WEBSOCKET_ENABLED`
  - `WEBSOCKET_CHANNEL`

## Configuration

Define your websocket configuration:

```ts
import { defineConfig } from '@ifullgaz/adonis-websocket'

export default defineConfig({
  enabled: true,
  channel: 'websocket:broadcast',
})
```

Environment values commonly used by the generated config:

```env
WEBSOCKET_ENABLED=true
WEBSOCKET_CHANNEL=websocket:broadcast
```

## Usage

### Register websocket routes

Use the helper:

```ts
import { websocketRoutes } from '@ifullgaz/adonis-websocket'

websocketRoutes()
```

Or define routes directly with the provider macro:

```ts
import app from '@adonisjs/core/services/app'
import router from '@adonisjs/core/services/router'

router.ws('ws/:channel', async (ctx) => {
  const server = await app.container.make('webSocketServer')
  await server.open(ctx)
})
```

### Broadcast from your application

```ts
import app from '@adonisjs/core/services/app'

const server = await app.container.make('webSocketServer')
await server.broadcast('notifications', { message: 'Hello from backend' })
```

When `enabled` is `true`, broadcast messages are sent through the bus channel
configured by `channel` and fanned out to connected sockets.

## Types

You can use exported package types in your app code:

```ts
import type {
  WebSocketConfig,
  WebSocketContext,
  WebSocketServerContract,
} from '@ifullgaz/adonis-websocket'
```

## Exports

- `@ifullgaz/adonis-websocket`
- `@ifullgaz/adonis-websocket/configure`
- `@ifullgaz/adonis-websocket/websocket_provider`
- `@ifullgaz/adonis-websocket/types`

## Testing

### Prerequisites

Tests require a `NODE_AUTH_TOKEN` with read access to the `@ifullgaz` GitHub Packages registry (see `.npmrc`). Export it before running:

```bash
export NODE_AUTH_TOKEN=<your_token>
```

### Running the suite

```bash
npm test            # lint → c8 coverage → full Japa suite
npm run quick:test  # Japa only, no lint/coverage — use during iteration
```

### Running a single test or group

Pass Japa filter flags directly to the test entry:

```bash
# by group name
node --import=./tsnode.esm.js --enable-source-maps bin/test.ts --groups "smoke"

# by test title (substring match)
node --import=./tsnode.esm.js --enable-source-maps bin/test.ts --tests "broadcast on a channel"
```

### Test harness (`tests_helpers/`)

The harness boots a **real AdonisJS 6 app** with a live HTTP server on an ephemeral port — no mocks for the HTTP/WS stack.

| Helper | What it does |
|--------|-------------|
| `bootApp(options?)` | Boots an app + listening server. Returns a `Harness` with `baseUrl`, `webSocketServer`, `nodeServer`, and a `close()` teardown. |
| `TestClient.connect(baseUrl, path, options?)` | Opens a WS connection; resolves once the handshake completes. Pass `{ token }` to test the `ws_auth` middleware. |
| `client.nextMessage()` / `client.nextJson()` | Await the next inbound frame. Rejects after 2 s — useful for asserting silence too. |
| `client.waitClose()` | Resolves with `{ code, reason }` when the server closes the socket. |
| `MockBusBroker` / `MockBus` | In-memory pub/sub double. Models the real bus behaviour (no echo to the publisher). |

### Writing a new test

```ts
import { test } from '@japa/runner'
import { bootApp, type Harness } from '../tests_helpers/boot_app.js'
import { TestClient } from '../tests_helpers/ws_client.js'

test.group('my feature', (group) => {
  let h: Harness
  group.each.setup(async () => {
    h = await bootApp()
    return () => h.close()
  })

  test('description', async ({ assert }) => {
    const client = await TestClient.connect(h.baseUrl, '/ws/room')
    client.send('hello')
    assert.equal(await client.nextMessage(), 'hello')
    await client.close()
  })
})
```

For multi-instance bus tests, share a `MockBusBroker` across two `bootApp` calls:

```ts
import { MockBusBroker } from '../tests_helpers/mock_bus.js'

const broker = new MockBusBroker()
const a = await bootApp({ broker, bus: { enabled: true, channel: 'ws:test' } })
const b = await bootApp({ broker, bus: { enabled: true, channel: 'ws:test' } })
// a broadcast on instance A reaches clients on instance B
```
