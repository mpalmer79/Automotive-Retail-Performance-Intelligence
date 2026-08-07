/**
 * The deal-grain partition table: every store × sale month, imported statically.
 *
 * WHY THIS IS A SEPARATE MODULE FROM `chunks.ts`
 * ----------------------------------------------
 * `chunks.ts` holds the five date-grained partitions the Executive Overview reads.
 * Adding the deal partitions to it would put 221 kB of transaction records into the
 * server module graph of every route that imports it — including `/dashboard`, which
 * has no deal-level content and no business holding any.
 *
 * `DASH.3` requires that chunks are not imported into unrelated dashboard routes, and
 * a module boundary is the only thing that actually enforces it: an import is a graph
 * edge whether or not the importing page renders a single field from it. So the deal
 * partitions live here, and only the deal routes import this file.
 * `tests/unit/dashboard-boundaries.test.ts` asserts that set of importers.
 *
 * WHY STATIC IMPORTS RATHER THAN A FILE-SYSTEM READ
 * -------------------------------------------------
 * The same reason `chunks.ts` gives, and it is a reason this repository has already
 * paid for: a server component that builds a path from `process.cwd()` defeats the
 * output tracer, which fails safe by copying the whole working directory into
 * `.next/standalone`. A static import is a graph edge the tracer resolves exactly.
 *
 * SERVER ONLY. A `'use client'` module importing this would ship every finalized
 * transaction to a browser.
 */
import type { DashboardDatasetFile } from '@/types/dashboard'

import deals001m202507 from '@/generated/dashboard/datasets/deal-explorer/GSA-001/2025-07.json'
import deals001m202508 from '@/generated/dashboard/datasets/deal-explorer/GSA-001/2025-08.json'
import deals001m202509 from '@/generated/dashboard/datasets/deal-explorer/GSA-001/2025-09.json'
import deals001m202510 from '@/generated/dashboard/datasets/deal-explorer/GSA-001/2025-10.json'
import deals001m202511 from '@/generated/dashboard/datasets/deal-explorer/GSA-001/2025-11.json'
import deals001m202512 from '@/generated/dashboard/datasets/deal-explorer/GSA-001/2025-12.json'
import deals002m202507 from '@/generated/dashboard/datasets/deal-explorer/GSA-002/2025-07.json'
import deals002m202508 from '@/generated/dashboard/datasets/deal-explorer/GSA-002/2025-08.json'
import deals002m202509 from '@/generated/dashboard/datasets/deal-explorer/GSA-002/2025-09.json'
import deals002m202510 from '@/generated/dashboard/datasets/deal-explorer/GSA-002/2025-10.json'
import deals002m202511 from '@/generated/dashboard/datasets/deal-explorer/GSA-002/2025-11.json'
import deals002m202512 from '@/generated/dashboard/datasets/deal-explorer/GSA-002/2025-12.json'
import deals003m202507 from '@/generated/dashboard/datasets/deal-explorer/GSA-003/2025-07.json'
import deals003m202508 from '@/generated/dashboard/datasets/deal-explorer/GSA-003/2025-08.json'
import deals003m202509 from '@/generated/dashboard/datasets/deal-explorer/GSA-003/2025-09.json'
import deals003m202510 from '@/generated/dashboard/datasets/deal-explorer/GSA-003/2025-10.json'
import deals003m202511 from '@/generated/dashboard/datasets/deal-explorer/GSA-003/2025-11.json'
import deals003m202512 from '@/generated/dashboard/datasets/deal-explorer/GSA-003/2025-12.json'

/** The partition key the manifest and this table agree on. */
export function dealChunkKey(dealershipId: string, month: string): string {
  return `${dealershipId}/${month}`
}

const DEAL_CHUNKS: Readonly<Record<string, unknown>> = {
  'GSA-001/2025-07': deals001m202507,
  'GSA-001/2025-08': deals001m202508,
  'GSA-001/2025-09': deals001m202509,
  'GSA-001/2025-10': deals001m202510,
  'GSA-001/2025-11': deals001m202511,
  'GSA-001/2025-12': deals001m202512,
  'GSA-002/2025-07': deals002m202507,
  'GSA-002/2025-08': deals002m202508,
  'GSA-002/2025-09': deals002m202509,
  'GSA-002/2025-10': deals002m202510,
  'GSA-002/2025-11': deals002m202511,
  'GSA-002/2025-12': deals002m202512,
  'GSA-003/2025-07': deals003m202507,
  'GSA-003/2025-08': deals003m202508,
  'GSA-003/2025-09': deals003m202509,
  'GSA-003/2025-10': deals003m202510,
  'GSA-003/2025-11': deals003m202511,
  'GSA-003/2025-12': deals003m202512,
}

/** A partition, or `undefined` when the export does not carry that store-month. */
export function dealChunkFile(
  dealershipId: string,
  month: string
): DashboardDatasetFile | undefined {
  const file = DEAL_CHUNKS[dealChunkKey(dealershipId, month)]
  return file === undefined ? undefined : (file as unknown as DashboardDatasetFile)
}

/** Every partition key this table carries, so a test can compare it to the manifest. */
export function dealChunkKeys(): readonly string[] {
  return Object.keys(DEAL_CHUNKS)
}
