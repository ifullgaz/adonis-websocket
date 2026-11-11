import type { ApplicationService } from '@adonisjs/core/types'
import { Router } from '@adonisjs/core/http'
import type { Route } from '@adonisjs/core/http'
import type { Constructor } from '@adonisjs/core/types/common'
import type {
  WebSocketConfig,
  WebSocketServerContract,
  WsRouteHandler,
} from '../src/types/types.js'

declare module '@adonisjs/core/types' {
  interface ContainerBindings {
    webSocketServer: WebSocketServerContract
  }
}

declare module '@adonisjs/core/http' {
  interface Router {
    ws<T extends Constructor<any>>(pattern: string, handler: WsRouteHandler<T>): Route<T>
  }
}

function installWsMacro() {
  Router.macro('ws', function (this: Router, pattern, handler) {
    return this.get(pattern, handler as any)
  })
}

installWsMacro()

export default class WebsocketProvider {
  constructor(protected app: ApplicationService) {}

  register() {
    this.app.container.singleton('webSocketServer', async () => {
      const { default: WebSocketServer } = await import('../src/core/server.js')
      const config = (await this.app.config.get('websocket')) as WebSocketConfig
      const bus = config.bus.factory ? await config.bus.factory() : undefined
      return new WebSocketServer(config, this.app, bus)
    })
  }

  async ready() {
    const server = await this.app.container.make('webSocketServer')
    await server.run()
    this.app.terminating(async () => {
      await server.shutdown()
    })
  }
}
