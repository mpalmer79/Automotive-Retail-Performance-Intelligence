/**
 * The generated target dataset, imported once for the two routes that read it.
 *
 * WHY THIS IS NOT IN `data.ts`
 * ----------------------------
 * Same rule `sales-gross-data.ts` follows: an import is a graph edge, and the bundler
 * inlines a file into the server chunk whether or not anything reads it. Two routes
 * read the operating plan — the Executive Overview and Sales and gross — and neither
 * the Deal Explorer nor the Deal Jacket does, so the import lives in a module those
 * two share rather than in the one every dashboard route imports.
 *
 * The file is 17 kB and unchunked: 72 rows, three stores × six months × four
 * scope-metric combinations. `DATA_CONTRACT.md` §9 asks for the measurement before the
 * chunking decision, and the measurement says one file.
 *
 * SERVER ONLY, like every module that touches the generated tree.
 */
import type { DashboardDatasetFile, DashboardRow } from '@/types/dashboard'

import targetFile from '@/generated/dashboard/datasets/target-attainment.json'

import { decodeDataset } from './data'

/** Every store-month-scope-metric row of the governed operating plan. */
export function targetAttainmentRows(): readonly DashboardRow[] {
  return decodeDataset('target-attainment', targetFile as unknown as DashboardDatasetFile)
}
