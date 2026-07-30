/**
 * Resolve the Chromium executable to drive.
 *
 * Playwright normally manages its own browser download and needs no help. This
 * helper exists for one case: a sandboxed development container that has a
 * Chromium pre-installed at a fixed path, whose build number does not match the
 * one the pinned `@playwright/test` expects. Playwright then refuses to launch
 * and tells you to run `playwright install`, which such a container generally
 * cannot do.
 *
 * Resolution order:
 *   1. `ARPI_CHROMIUM_PATH`, if it points at an existing file.
 *   2. `$PLAYWRIGHT_BROWSERS_PATH/chromium`, if that exists. The pre-installed
 *      containers in this project's environment provide it as a symlink.
 *   3. `undefined`, meaning "let Playwright pick", which is what CI does and
 *      what a normal developer machine does.
 *
 * Returning `undefined` rather than throwing matters: CI installs the matching
 * browser itself, and a helper that insisted on a path would break the case it
 * was not written for.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function resolveChromiumPath(): string | undefined {
  const explicit = process.env.ARPI_CHROMIUM_PATH
  if (explicit && existsSync(explicit)) return explicit

  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (browsersRoot) {
    const candidate = join(browsersRoot, 'chromium')
    if (existsSync(candidate)) return candidate
  }

  return undefined
}
