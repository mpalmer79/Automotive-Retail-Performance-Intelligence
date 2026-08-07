/**
 * The Deal Jacket partition table: every store × sale month, imported statically.
 *
 * A THIRD PARTITION MODULE, AND THE REASON IS THE SAME AS THE OTHER TWO
 * ---------------------------------------------------------------------
 * An import is a graph edge. `deal-jacket` carries the cost components, the trade
 * amounts and the finance amounts that `deal-explorer` deliberately omits: 443 kB
 * against the index's 221 kB, for the same 650 transactions. Putting it in
 * `deal-chunks.ts` would place all of it into the Deal Explorer's server graph, which
 * shows none of it, to serve a route that is not the index.
 *
 * So the jacket's data lives here, and only `/dashboard/deals/[saleId]` reads it.
 * `tests/unit/dashboard-boundaries.test.ts` asserts the importer set.
 *
 * WHY STATIC IMPORTS RATHER THAN A FILE-SYSTEM READ
 * -------------------------------------------------
 * The reason `chunks.ts` records and this repository has already paid for: a server
 * component that builds a path from `process.cwd()` defeats the output tracer, which
 * fails safe by copying the whole working directory into `.next/standalone`.
 *
 * SERVER ONLY.
 */
import type { DashboardDatasetFile } from '@/types/dashboard'

import jacket001m202507 from '@/generated/dashboard/datasets/deal-jacket/GSA-001/2025-07.json'
import jacket001m202508 from '@/generated/dashboard/datasets/deal-jacket/GSA-001/2025-08.json'
import jacket001m202509 from '@/generated/dashboard/datasets/deal-jacket/GSA-001/2025-09.json'
import jacket001m202510 from '@/generated/dashboard/datasets/deal-jacket/GSA-001/2025-10.json'
import jacket001m202511 from '@/generated/dashboard/datasets/deal-jacket/GSA-001/2025-11.json'
import jacket001m202512 from '@/generated/dashboard/datasets/deal-jacket/GSA-001/2025-12.json'
import jacket002m202507 from '@/generated/dashboard/datasets/deal-jacket/GSA-002/2025-07.json'
import jacket002m202508 from '@/generated/dashboard/datasets/deal-jacket/GSA-002/2025-08.json'
import jacket002m202509 from '@/generated/dashboard/datasets/deal-jacket/GSA-002/2025-09.json'
import jacket002m202510 from '@/generated/dashboard/datasets/deal-jacket/GSA-002/2025-10.json'
import jacket002m202511 from '@/generated/dashboard/datasets/deal-jacket/GSA-002/2025-11.json'
import jacket002m202512 from '@/generated/dashboard/datasets/deal-jacket/GSA-002/2025-12.json'
import jacket003m202507 from '@/generated/dashboard/datasets/deal-jacket/GSA-003/2025-07.json'
import jacket003m202508 from '@/generated/dashboard/datasets/deal-jacket/GSA-003/2025-08.json'
import jacket003m202509 from '@/generated/dashboard/datasets/deal-jacket/GSA-003/2025-09.json'
import jacket003m202510 from '@/generated/dashboard/datasets/deal-jacket/GSA-003/2025-10.json'
import jacket003m202511 from '@/generated/dashboard/datasets/deal-jacket/GSA-003/2025-11.json'
import jacket003m202512 from '@/generated/dashboard/datasets/deal-jacket/GSA-003/2025-12.json'

/** The partition key the manifest and this table agree on. */
export function jacketChunkKey(dealershipId: string, month: string): string {
  return `${dealershipId}/${month}`
}

const JACKET_CHUNKS: Readonly<Record<string, unknown>> = {
  'GSA-001/2025-07': jacket001m202507,
  'GSA-001/2025-08': jacket001m202508,
  'GSA-001/2025-09': jacket001m202509,
  'GSA-001/2025-10': jacket001m202510,
  'GSA-001/2025-11': jacket001m202511,
  'GSA-001/2025-12': jacket001m202512,
  'GSA-002/2025-07': jacket002m202507,
  'GSA-002/2025-08': jacket002m202508,
  'GSA-002/2025-09': jacket002m202509,
  'GSA-002/2025-10': jacket002m202510,
  'GSA-002/2025-11': jacket002m202511,
  'GSA-002/2025-12': jacket002m202512,
  'GSA-003/2025-07': jacket003m202507,
  'GSA-003/2025-08': jacket003m202508,
  'GSA-003/2025-09': jacket003m202509,
  'GSA-003/2025-10': jacket003m202510,
  'GSA-003/2025-11': jacket003m202511,
  'GSA-003/2025-12': jacket003m202512,
}

/** A partition, or `undefined` when the export does not carry that store-month. */
export function jacketChunkFile(
  dealershipId: string,
  month: string
): DashboardDatasetFile | undefined {
  const file = JACKET_CHUNKS[jacketChunkKey(dealershipId, month)]
  return file === undefined ? undefined : (file as unknown as DashboardDatasetFile)
}

/** Every partition key this table carries, so a test can compare it to the manifest. */
export function jacketChunkKeys(): readonly string[] {
  return Object.keys(JACKET_CHUNKS)
}

/** Every partition, for the lookup that has no store or month to narrow by. */
export function allJacketChunks(): readonly DashboardDatasetFile[] {
  return Object.values(JACKET_CHUNKS) as unknown as DashboardDatasetFile[]
}
