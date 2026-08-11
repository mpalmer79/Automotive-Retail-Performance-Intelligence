/**
 * The generated action queue, imported once for the two routes that render it.
 *
 * WHY THIS IS NOT IN `data.ts`
 * ----------------------------
 * The rule every narrow door here follows: an import is a graph edge, and the bundler
 * inlines a file into the server chunk whether or not anything reads it. `data.ts` is
 * imported by every dashboard route, and only two of them show actions.
 *
 *   management-actions.json   88 kB, 47 actions, one file
 *
 * Unchunked on the measurement, and `DATA_CONTRACT.md` asks for the measurement before the
 * chunking decision. Partitioning a queue this size by store and month would add pointer
 * indirection to save nothing — and would also be the wrong shape, since an action's scope
 * is set by its rule rather than by a month.
 *
 * WHY THE EXECUTIVE OVERVIEW MAY IMPORT THE WHOLE QUEUE
 * ----------------------------------------------------
 * It renders the few highest-severity prompts, and choosing them requires seeing all of
 * them: a top-five taken from a partition is a top-five of that partition. 88 kB is the
 * entire queue, so the narrow set IS the summary and no second aggregate needs inventing.
 * `tests/unit/dashboard-boundaries.test.ts` holds the door list to its declared members.
 *
 * SERVER ONLY, like every module that touches the generated tree.
 */
import type { DashboardActionFile, ManagementAction } from '@/types/dashboard'

import actionFile from '@/generated/dashboard/management-actions.json'

/**
 * Every action in the current dataset version, in the queue's published order.
 *
 * No decoding step, unlike a dataset: the queue is written row-per-object precisely because
 * its evidence and thresholds are nested, so what is read here is what the generator wrote.
 */
export function managementActions(): readonly ManagementAction[] {
  return (actionFile as unknown as DashboardActionFile).actions
}
