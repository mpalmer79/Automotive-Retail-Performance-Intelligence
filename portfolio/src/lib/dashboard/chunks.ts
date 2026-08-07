/**
 * The chunk partition table: every store × month file, imported statically.
 *
 * WHY NINETY IMPORTS AND NOT A FILE-SYSTEM READ
 * ---------------------------------------------
 * This repository has already paid for the alternative. `next.config.ts` records
 * it: a server component asked the file system a question built from
 * `process.cwd()`, the output tracer could not resolve the path statically, it
 * failed safe by copying the entire working directory into `.next/standalone`,
 * and the Railway image job failed with "/app/tests is present in the runtime
 * image". The lesson recorded there is not "exclude tests" — it is "stop asking
 * the question from inside the traced graph".
 *
 * A static import is a graph edge. The tracer resolves it, the bundler includes
 * exactly the files named, `.next/standalone` receives exactly those files, and
 * nothing is discovered at runtime. It is verbose in the way an explicit thing is
 * verbose, and it cannot be wrong in a way that only appears in production.
 *
 * WHY IT CANNOT DRIFT
 * -------------------
 * `DATA_CONTRACT.md` §9 makes the file set closed: the client manifest's chunk
 * index carries every partition with its row count and measured bytes. This table
 * is asserted against that index in both directions by
 * `tests/unit/dashboard-executive.test.tsx`, so a seventh month in the export that
 * is missing here is a failing test rather than an empty section on a page.
 *
 * SERVER ONLY. Two and a half megabytes of governed data; a `'use client'` module
 * that imported it would ship it to a browser. `tests/unit/dashboard-boundaries.test.ts`
 * asserts no client module reaches a chunk path.
 */
import type { DashboardDatasetFile } from '@/types/dashboard'

/** The chunked datasets, as `DASHBOARD_DATASETS` marks them. */
export type ChunkedDatasetName =
  'inventory-health' | 'inventory-aging' | 'days-supply' | 'lead-funnel' | 'lead-response'

/** One dataset's partitions, keyed `GSA-00#/YYYY-MM` exactly as the manifest keys them. */
export type ChunkTable = Readonly<Record<string, unknown>>

/** The partition key the manifest and this table agree on. */
export function chunkKey(dealershipId: string, month: string): string {
  return `${dealershipId}/${month}`
}

/** A partition, or `undefined` when the export does not carry that store-month. */
export function chunkFile(
  dataset: ChunkedDatasetName,
  dealershipId: string,
  month: string
): DashboardDatasetFile | undefined {
  const table = CHUNK_TABLES[dataset]
  const file = table[chunkKey(dealershipId, month)]
  return file === undefined ? undefined : (file as unknown as DashboardDatasetFile)
}

import aging001m202507 from '@/generated/dashboard/datasets/inventory-aging/GSA-001/2025-07.json'
import aging001m202508 from '@/generated/dashboard/datasets/inventory-aging/GSA-001/2025-08.json'
import aging001m202509 from '@/generated/dashboard/datasets/inventory-aging/GSA-001/2025-09.json'
import aging001m202510 from '@/generated/dashboard/datasets/inventory-aging/GSA-001/2025-10.json'
import aging001m202511 from '@/generated/dashboard/datasets/inventory-aging/GSA-001/2025-11.json'
import aging001m202512 from '@/generated/dashboard/datasets/inventory-aging/GSA-001/2025-12.json'
import aging002m202507 from '@/generated/dashboard/datasets/inventory-aging/GSA-002/2025-07.json'
import aging002m202508 from '@/generated/dashboard/datasets/inventory-aging/GSA-002/2025-08.json'
import aging002m202509 from '@/generated/dashboard/datasets/inventory-aging/GSA-002/2025-09.json'
import aging002m202510 from '@/generated/dashboard/datasets/inventory-aging/GSA-002/2025-10.json'
import aging002m202511 from '@/generated/dashboard/datasets/inventory-aging/GSA-002/2025-11.json'
import aging002m202512 from '@/generated/dashboard/datasets/inventory-aging/GSA-002/2025-12.json'
import aging003m202507 from '@/generated/dashboard/datasets/inventory-aging/GSA-003/2025-07.json'
import aging003m202508 from '@/generated/dashboard/datasets/inventory-aging/GSA-003/2025-08.json'
import aging003m202509 from '@/generated/dashboard/datasets/inventory-aging/GSA-003/2025-09.json'
import aging003m202510 from '@/generated/dashboard/datasets/inventory-aging/GSA-003/2025-10.json'
import aging003m202511 from '@/generated/dashboard/datasets/inventory-aging/GSA-003/2025-11.json'
import aging003m202512 from '@/generated/dashboard/datasets/inventory-aging/GSA-003/2025-12.json'
import funnel001m202507 from '@/generated/dashboard/datasets/lead-funnel/GSA-001/2025-07.json'
import funnel001m202508 from '@/generated/dashboard/datasets/lead-funnel/GSA-001/2025-08.json'
import funnel001m202509 from '@/generated/dashboard/datasets/lead-funnel/GSA-001/2025-09.json'
import funnel001m202510 from '@/generated/dashboard/datasets/lead-funnel/GSA-001/2025-10.json'
import funnel001m202511 from '@/generated/dashboard/datasets/lead-funnel/GSA-001/2025-11.json'
import funnel001m202512 from '@/generated/dashboard/datasets/lead-funnel/GSA-001/2025-12.json'
import funnel002m202507 from '@/generated/dashboard/datasets/lead-funnel/GSA-002/2025-07.json'
import funnel002m202508 from '@/generated/dashboard/datasets/lead-funnel/GSA-002/2025-08.json'
import funnel002m202509 from '@/generated/dashboard/datasets/lead-funnel/GSA-002/2025-09.json'
import funnel002m202510 from '@/generated/dashboard/datasets/lead-funnel/GSA-002/2025-10.json'
import funnel002m202511 from '@/generated/dashboard/datasets/lead-funnel/GSA-002/2025-11.json'
import funnel002m202512 from '@/generated/dashboard/datasets/lead-funnel/GSA-002/2025-12.json'
import funnel003m202507 from '@/generated/dashboard/datasets/lead-funnel/GSA-003/2025-07.json'
import funnel003m202508 from '@/generated/dashboard/datasets/lead-funnel/GSA-003/2025-08.json'
import funnel003m202509 from '@/generated/dashboard/datasets/lead-funnel/GSA-003/2025-09.json'
import funnel003m202510 from '@/generated/dashboard/datasets/lead-funnel/GSA-003/2025-10.json'
import funnel003m202511 from '@/generated/dashboard/datasets/lead-funnel/GSA-003/2025-11.json'
import funnel003m202512 from '@/generated/dashboard/datasets/lead-funnel/GSA-003/2025-12.json'
import health001m202507 from '@/generated/dashboard/datasets/inventory-health/GSA-001/2025-07.json'
import health001m202508 from '@/generated/dashboard/datasets/inventory-health/GSA-001/2025-08.json'
import health001m202509 from '@/generated/dashboard/datasets/inventory-health/GSA-001/2025-09.json'
import health001m202510 from '@/generated/dashboard/datasets/inventory-health/GSA-001/2025-10.json'
import health001m202511 from '@/generated/dashboard/datasets/inventory-health/GSA-001/2025-11.json'
import health001m202512 from '@/generated/dashboard/datasets/inventory-health/GSA-001/2025-12.json'
import health002m202507 from '@/generated/dashboard/datasets/inventory-health/GSA-002/2025-07.json'
import health002m202508 from '@/generated/dashboard/datasets/inventory-health/GSA-002/2025-08.json'
import health002m202509 from '@/generated/dashboard/datasets/inventory-health/GSA-002/2025-09.json'
import health002m202510 from '@/generated/dashboard/datasets/inventory-health/GSA-002/2025-10.json'
import health002m202511 from '@/generated/dashboard/datasets/inventory-health/GSA-002/2025-11.json'
import health002m202512 from '@/generated/dashboard/datasets/inventory-health/GSA-002/2025-12.json'
import health003m202507 from '@/generated/dashboard/datasets/inventory-health/GSA-003/2025-07.json'
import health003m202508 from '@/generated/dashboard/datasets/inventory-health/GSA-003/2025-08.json'
import health003m202509 from '@/generated/dashboard/datasets/inventory-health/GSA-003/2025-09.json'
import health003m202510 from '@/generated/dashboard/datasets/inventory-health/GSA-003/2025-10.json'
import health003m202511 from '@/generated/dashboard/datasets/inventory-health/GSA-003/2025-11.json'
import health003m202512 from '@/generated/dashboard/datasets/inventory-health/GSA-003/2025-12.json'
import response001m202507 from '@/generated/dashboard/datasets/lead-response/GSA-001/2025-07.json'
import response001m202508 from '@/generated/dashboard/datasets/lead-response/GSA-001/2025-08.json'
import response001m202509 from '@/generated/dashboard/datasets/lead-response/GSA-001/2025-09.json'
import response001m202510 from '@/generated/dashboard/datasets/lead-response/GSA-001/2025-10.json'
import response001m202511 from '@/generated/dashboard/datasets/lead-response/GSA-001/2025-11.json'
import response001m202512 from '@/generated/dashboard/datasets/lead-response/GSA-001/2025-12.json'
import response002m202507 from '@/generated/dashboard/datasets/lead-response/GSA-002/2025-07.json'
import response002m202508 from '@/generated/dashboard/datasets/lead-response/GSA-002/2025-08.json'
import response002m202509 from '@/generated/dashboard/datasets/lead-response/GSA-002/2025-09.json'
import response002m202510 from '@/generated/dashboard/datasets/lead-response/GSA-002/2025-10.json'
import response002m202511 from '@/generated/dashboard/datasets/lead-response/GSA-002/2025-11.json'
import response002m202512 from '@/generated/dashboard/datasets/lead-response/GSA-002/2025-12.json'
import response003m202507 from '@/generated/dashboard/datasets/lead-response/GSA-003/2025-07.json'
import response003m202508 from '@/generated/dashboard/datasets/lead-response/GSA-003/2025-08.json'
import response003m202509 from '@/generated/dashboard/datasets/lead-response/GSA-003/2025-09.json'
import response003m202510 from '@/generated/dashboard/datasets/lead-response/GSA-003/2025-10.json'
import response003m202511 from '@/generated/dashboard/datasets/lead-response/GSA-003/2025-11.json'
import response003m202512 from '@/generated/dashboard/datasets/lead-response/GSA-003/2025-12.json'
import supply001m202507 from '@/generated/dashboard/datasets/days-supply/GSA-001/2025-07.json'
import supply001m202508 from '@/generated/dashboard/datasets/days-supply/GSA-001/2025-08.json'
import supply001m202509 from '@/generated/dashboard/datasets/days-supply/GSA-001/2025-09.json'
import supply001m202510 from '@/generated/dashboard/datasets/days-supply/GSA-001/2025-10.json'
import supply001m202511 from '@/generated/dashboard/datasets/days-supply/GSA-001/2025-11.json'
import supply001m202512 from '@/generated/dashboard/datasets/days-supply/GSA-001/2025-12.json'
import supply002m202507 from '@/generated/dashboard/datasets/days-supply/GSA-002/2025-07.json'
import supply002m202508 from '@/generated/dashboard/datasets/days-supply/GSA-002/2025-08.json'
import supply002m202509 from '@/generated/dashboard/datasets/days-supply/GSA-002/2025-09.json'
import supply002m202510 from '@/generated/dashboard/datasets/days-supply/GSA-002/2025-10.json'
import supply002m202511 from '@/generated/dashboard/datasets/days-supply/GSA-002/2025-11.json'
import supply002m202512 from '@/generated/dashboard/datasets/days-supply/GSA-002/2025-12.json'
import supply003m202507 from '@/generated/dashboard/datasets/days-supply/GSA-003/2025-07.json'
import supply003m202508 from '@/generated/dashboard/datasets/days-supply/GSA-003/2025-08.json'
import supply003m202509 from '@/generated/dashboard/datasets/days-supply/GSA-003/2025-09.json'
import supply003m202510 from '@/generated/dashboard/datasets/days-supply/GSA-003/2025-10.json'
import supply003m202511 from '@/generated/dashboard/datasets/days-supply/GSA-003/2025-11.json'
import supply003m202512 from '@/generated/dashboard/datasets/days-supply/GSA-003/2025-12.json'

/** `inventory-health`, 18 partitions: three stores over six months. */
const healthChunks: ChunkTable = {
  'GSA-001/2025-07': health001m202507,
  'GSA-001/2025-08': health001m202508,
  'GSA-001/2025-09': health001m202509,
  'GSA-001/2025-10': health001m202510,
  'GSA-001/2025-11': health001m202511,
  'GSA-001/2025-12': health001m202512,
  'GSA-002/2025-07': health002m202507,
  'GSA-002/2025-08': health002m202508,
  'GSA-002/2025-09': health002m202509,
  'GSA-002/2025-10': health002m202510,
  'GSA-002/2025-11': health002m202511,
  'GSA-002/2025-12': health002m202512,
  'GSA-003/2025-07': health003m202507,
  'GSA-003/2025-08': health003m202508,
  'GSA-003/2025-09': health003m202509,
  'GSA-003/2025-10': health003m202510,
  'GSA-003/2025-11': health003m202511,
  'GSA-003/2025-12': health003m202512,
}

/** `inventory-aging`, 18 partitions: three stores over six months. */
const agingChunks: ChunkTable = {
  'GSA-001/2025-07': aging001m202507,
  'GSA-001/2025-08': aging001m202508,
  'GSA-001/2025-09': aging001m202509,
  'GSA-001/2025-10': aging001m202510,
  'GSA-001/2025-11': aging001m202511,
  'GSA-001/2025-12': aging001m202512,
  'GSA-002/2025-07': aging002m202507,
  'GSA-002/2025-08': aging002m202508,
  'GSA-002/2025-09': aging002m202509,
  'GSA-002/2025-10': aging002m202510,
  'GSA-002/2025-11': aging002m202511,
  'GSA-002/2025-12': aging002m202512,
  'GSA-003/2025-07': aging003m202507,
  'GSA-003/2025-08': aging003m202508,
  'GSA-003/2025-09': aging003m202509,
  'GSA-003/2025-10': aging003m202510,
  'GSA-003/2025-11': aging003m202511,
  'GSA-003/2025-12': aging003m202512,
}

/** `days-supply`, 18 partitions: three stores over six months. */
const supplyChunks: ChunkTable = {
  'GSA-001/2025-07': supply001m202507,
  'GSA-001/2025-08': supply001m202508,
  'GSA-001/2025-09': supply001m202509,
  'GSA-001/2025-10': supply001m202510,
  'GSA-001/2025-11': supply001m202511,
  'GSA-001/2025-12': supply001m202512,
  'GSA-002/2025-07': supply002m202507,
  'GSA-002/2025-08': supply002m202508,
  'GSA-002/2025-09': supply002m202509,
  'GSA-002/2025-10': supply002m202510,
  'GSA-002/2025-11': supply002m202511,
  'GSA-002/2025-12': supply002m202512,
  'GSA-003/2025-07': supply003m202507,
  'GSA-003/2025-08': supply003m202508,
  'GSA-003/2025-09': supply003m202509,
  'GSA-003/2025-10': supply003m202510,
  'GSA-003/2025-11': supply003m202511,
  'GSA-003/2025-12': supply003m202512,
}

/** `lead-funnel`, 18 partitions: three stores over six months. */
const funnelChunks: ChunkTable = {
  'GSA-001/2025-07': funnel001m202507,
  'GSA-001/2025-08': funnel001m202508,
  'GSA-001/2025-09': funnel001m202509,
  'GSA-001/2025-10': funnel001m202510,
  'GSA-001/2025-11': funnel001m202511,
  'GSA-001/2025-12': funnel001m202512,
  'GSA-002/2025-07': funnel002m202507,
  'GSA-002/2025-08': funnel002m202508,
  'GSA-002/2025-09': funnel002m202509,
  'GSA-002/2025-10': funnel002m202510,
  'GSA-002/2025-11': funnel002m202511,
  'GSA-002/2025-12': funnel002m202512,
  'GSA-003/2025-07': funnel003m202507,
  'GSA-003/2025-08': funnel003m202508,
  'GSA-003/2025-09': funnel003m202509,
  'GSA-003/2025-10': funnel003m202510,
  'GSA-003/2025-11': funnel003m202511,
  'GSA-003/2025-12': funnel003m202512,
}

/** `lead-response`, 18 partitions: three stores over six months. */
const responseChunks: ChunkTable = {
  'GSA-001/2025-07': response001m202507,
  'GSA-001/2025-08': response001m202508,
  'GSA-001/2025-09': response001m202509,
  'GSA-001/2025-10': response001m202510,
  'GSA-001/2025-11': response001m202511,
  'GSA-001/2025-12': response001m202512,
  'GSA-002/2025-07': response002m202507,
  'GSA-002/2025-08': response002m202508,
  'GSA-002/2025-09': response002m202509,
  'GSA-002/2025-10': response002m202510,
  'GSA-002/2025-11': response002m202511,
  'GSA-002/2025-12': response002m202512,
  'GSA-003/2025-07': response003m202507,
  'GSA-003/2025-08': response003m202508,
  'GSA-003/2025-09': response003m202509,
  'GSA-003/2025-10': response003m202510,
  'GSA-003/2025-11': response003m202511,
  'GSA-003/2025-12': response003m202512,
}

/**
 * Every chunked dataset's partition table, keyed exactly as the manifest keys it.
 */
export const CHUNK_TABLES: Readonly<Record<ChunkedDatasetName, ChunkTable>> = {
  'inventory-health': healthChunks,
  'inventory-aging': agingChunks,
  'days-supply': supplyChunks,
  'lead-funnel': funnelChunks,
  'lead-response': responseChunks,
}
