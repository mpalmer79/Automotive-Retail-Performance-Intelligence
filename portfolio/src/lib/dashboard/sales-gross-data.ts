/**
 * The two generated datasets only `/dashboard/sales-gross` reads.
 *
 * WHY THIS IS NOT IN `data.ts`
 * ----------------------------
 * `data.ts` states the rule this module follows: an import is a graph edge, and the
 * bundler inlines a file into the server chunk whether or not anything reads it. It
 * imports six whole datasets because the Executive Overview reads six, and it names
 * the omissions deliberately.
 *
 * `sales-gross-trend.json` is 95 kB. Adding it to `data.ts` would put it into
 * `/dashboard`'s server graph, which has no trend content, to serve a route that is
 * not `/dashboard`. So the two datasets this page owns are imported here, and the
 * page imports this module. `data.ts` keeps the shared helpers, including the row
 * decoder, so nothing is duplicated except the import itself.
 *
 * SERVER ONLY, like every module that touches the generated tree.
 */
import type { DashboardDatasetFile, DashboardRow } from '@/types/dashboard'

import bridgeFile from '@/generated/dashboard/datasets/gross-change-bridge.json'
import trendFile from '@/generated/dashboard/datasets/sales-gross-trend.json'

import { decodeDataset } from './data'

/** Every store-day row of the sales and gross trend. */
export function salesGrossTrendRows(): readonly DashboardRow[] {
  return decodeDataset('sales-gross-trend', trendFile as unknown as DashboardDatasetFile)
}

/** Every store-month-component row of the gross change bridge. */
export function grossChangeBridgeRows(): readonly DashboardRow[] {
  return decodeDataset('gross-change-bridge', bridgeFile as unknown as DashboardDatasetFile)
}
