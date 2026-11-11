/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/
import app from '@adonisjs/core/services/app'
import router from '@adonisjs/core/services/router'

export function websocketRoutes() {
  router.ws('ws/:channel', async (ctx) => {
    const server = await app.container.make('webSocketServer')
    await server.open(ctx)
  })
}
