/*
|--------------------------------------------------------------------------
| Configure hook
|--------------------------------------------------------------------------
|
| The configure hook is called when someone runs "node ace configure <package>"
| command. You are free to perform any operations inside this function to
| configure the package.
|
| To make things easier, you have access to the underlying "Configure"
| instance and you can use codemods to modify the source files.
|
*/

import type Configure from '@adonisjs/core/commands/configure'
import { stubsRoot } from './stubs/main.js'

export async function configure(command: Configure) {
  const codemods = await command.createCodemods()

  await codemods.updateRcFile((rcFile) => {
    rcFile.addProvider('@ifullgaz/adonis-websocket/provider')
  })

  await codemods.makeUsingStub(stubsRoot, 'config.stub', {})

  await codemods.registerMiddleware('named', [
    {
      name: 'ws_auth',
      path: '@ifullgaz/adonis-websocket/middleware/auth_middleware',
    },
  ])

  await codemods.defineEnvVariables({
    WEBSOCKET_ENABLED: true,
    WEBSOCKET_CHANNEL: 'websocket:broadcast',
  })

  await codemods.defineEnvValidations({
    variables: {
      WEBSOCKET_ENABLED: 'Env.schema.boolean.optional()',
      WEBSOCKET_CHANNEL: 'Env.schema.string.optional()',
    },
  })
}
