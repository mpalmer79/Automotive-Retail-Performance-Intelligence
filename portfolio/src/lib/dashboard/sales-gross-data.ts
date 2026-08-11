/**
 * The generated dataset only `/dashboard/sales-gross` reads.
 *
 * WHY THIS IS NOT IN `data.ts`
 * ----------------------------
 * `data.ts` states the rule this module follows: an import is a graph edge, and the
 * bundler inlines a file into the server chunk whether or not anything reads it. It
 * imports six whole datasets because the Executive Overview reads six, and it names
 * the omissions deliberately.
 *
 * `sales-gross-trend.json` is 95 kB. Adding it to `data.ts` would put it into the
 * Executive Overview's server graph, which has no trend content, to serve a route
 * that is not the Executive Overview. So the dataset this page owns is imported
 * here, and the page imports this module. `data.ts` keeps the shared helpers,
 * including the row decoder, so nothing is duplicated except the import itself.
 *
 * The gross-change bridge USED to live here too. `DASH.12` moved it to
 * `change-drivers-data.ts`, because two more routes render change drivers and
 * neither of them should acquire 95 kB of trend to do it.
 *
 * SERVER ONLY, like every module that touches the generated tree.
 */
import type { DashboardDatasetFile, DashboardRow } from '@/types/dashboard'

import trendFile from '@/generated/dashboard/datasets/sales-gross-trend.json'

import { decodeDataset } from './data'

/** Every store-day row of the sales and gross trend. */
export function salesGrossTrendRows(): readonly DashboardRow[] {
  return decodeDataset('sales-gross-trend', trendFile as unknown as DashboardDatasetFile)
}
