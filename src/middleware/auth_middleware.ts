import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Updating the "Accept" header to always accept "application/json" response
 * from the server. This will force the internals of the framework like
 * validator errors or auth errors to return a JSON response.
 */
export default class WebsocketAuthMiddleware {
  async handle({ request }: HttpContext, next: NextFn) {
    const qs = request.qs()
    if ('token' in qs) {
      const token = qs['token']
      delete qs['token']
      request.updateQs(qs)
      const headers = request.headers()
      headers.authorization = `Bearer ${token}`
    }

    return next()
  }
}
