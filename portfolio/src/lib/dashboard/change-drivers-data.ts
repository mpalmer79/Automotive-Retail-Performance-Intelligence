/**
 * The gross-change bridge, imported once for the three routes that read it.
 *
 * WHY THIS IS NOT IN `sales-gross-data.ts`
 * ----------------------------------------
 * It was, until `DASH.12`. That module also imports `sales-gross-trend.json`, which is
 * 95 kB, and an import is a graph edge whether or not anything reads what it pulls in. The
 * Executive Overview and the Action Center both render change drivers and neither has any
 * use for a store-day trend, so keeping the two behind one door would have put 95 kB into
 * two server graphs to serve a 15 kB dataset.
 *
 * The bridge is 54 rows: three stores x six months x three components, unchunked on the
 * measurement.
 *
 * SERVER ONLY, like every module that touches the generated tree.
 */
import type { DashboardDatasetFile, DashboardRow } from '@/types/dashboard'

import bridgeFile from '@/generated/dashboard/datasets/gross-change-bridge.json'

import { decodeDataset } from './data'

/** Every store-month-component row of the gross change bridge. */
export function grossChangeBridgeRows(): readonly DashboardRow[] {
  return decodeDataset(
    'gross-change-bridge',
    bridgeFile as unknown as DashboardDatasetFile
  )
}
