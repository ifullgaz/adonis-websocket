/*
|--------------------------------------------------------------------------
| Logger spy
|--------------------------------------------------------------------------
|
| `src/core/server.ts` logs via the process-global `@adonisjs/core/services/logger`
| singleton (the one place a global service is still correct — logging is
| process-wide, not per-app). This spy monkeypatches the resolved logger instance
| so tests can ASSERT that the error / error-handler paths logged (not merely
| execute them).
|
|   const spy = await spyLogger()     // captures 'error' by default
|   ... trigger the error path ...
|   assert.isAbove(spy.matching('WebSocket /ws/room').length, 0)
|   spy.restore()                     // always restore in teardown
|
| NOTE: the `@adonisjs/core/services/logger` proxy is imported DYNAMICALLY (not at
| module top) — its module runs `await app.booted()` on first eval, so a top-level
| import would crash before any app exists (harness ordering rule). It is also the
| process-global logger `server.ts` actually writes to (captured once at the first
| boot), so we must patch THAT instance, not a per-boot `app.container` logger.
*/

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

export interface LogRecord {
  level: LogLevel
  args: any[]
}

export interface LoggerSpy {
  /** Every captured call, in order. */
  records: LogRecord[]
  /** Records with any string arg containing `substr` (the message is usually arg 0 or 1). */
  matching(substr: string): LogRecord[]
  /** Restore the original logger methods. Call in teardown. */
  restore(): void
}

export async function spyLogger(levels: LogLevel[] = ['error']): Promise<LoggerSpy> {
  const { default: logger } = await import('@adonisjs/core/services/logger')
  const records: LogRecord[] = []
  const restores: Array<() => void> = []

  for (const level of levels) {
    const original = (logger as any)[level]
    ;(logger as any)[level] = function (this: unknown, ...args: any[]) {
      records.push({ level, args })
      return original.apply(this, args)
    }
    restores.push(() => {
      ;(logger as any)[level] = original
    })
  }

  return {
    records,
    matching(substr: string) {
      return records.filter((r) => r.args.some((a) => typeof a === 'string' && a.includes(substr)))
    },
    restore() {
      restores.forEach((fn) => fn())
    },
  }
}
