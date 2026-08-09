/**
 * The unit-grain inventory partition table: every store x snapshot month, imported statically.
 *
 * WHY THIS IS A SEPARATE MODULE
 * ------------------------------
 * `chunks.ts` holds the five aggregate partitions the Executive Overview reads. These are
 * unit-level rows -- one per vehicle per month end -- and putting them there would pull
 * 356 kB of stock detail into the server module graph of every route importing it,
 * including `/dashboard`, which has no unit-level content and no business holding any.
 *
 * A module boundary is the only thing that actually enforces route scoping: an import is
 * a graph edge whether or not the importing page renders a single field from it. So the
 * unit partitions live here and only `/dashboard/inventory` imports this file.
 *
 * WHY STATIC IMPORTS RATHER THAN A FILE-SYSTEM READ
 * -------------------------------------------------
 * The same reason `chunks.ts` and `deal-chunks.ts` give, and one this repository has
 * already paid for: a server component that builds a path from `process.cwd()` defeats
 * the output tracer, which fails safe by copying the whole working directory into
 * `.next/standalone`. A static import is a graph edge the tracer resolves exactly.
 *
 * SERVER ONLY. A `'use client'` module importing this would ship the whole partition set
 * to a browser.
 */
import type { DashboardDatasetFile } from '@/types/dashboard'

import units001m202507 from '@/generated/dashboard/datasets/inventory-units/GSA-001/2025-07.json'
import units001m202508 from '@/generated/dashboard/datasets/inventory-units/GSA-001/2025-08.json'
import units001m202509 from '@/generated/dashboard/datasets/inventory-units/GSA-001/2025-09.json'
import units001m202510 from '@/generated/dashboard/datasets/inventory-units/GSA-001/2025-10.json'
import units001m202511 from '@/generated/dashboard/datasets/inventory-units/GSA-001/2025-11.json'
import units001m202512 from '@/generated/dashboard/datasets/inventory-units/GSA-001/2025-12.json'
import units002m202507 from '@/generated/dashboard/datasets/inventory-units/GSA-002/2025-07.json'
import units002m202508 from '@/generated/dashboard/datasets/inventory-units/GSA-002/2025-08.json'
import units002m202509 from '@/generated/dashboard/datasets/inventory-units/GSA-002/2025-09.json'
import units002m202510 from '@/generated/dashboard/datasets/inventory-units/GSA-002/2025-10.json'
import units002m202511 from '@/generated/dashboard/datasets/inventory-units/GSA-002/2025-11.json'
import units002m202512 from '@/generated/dashboard/datasets/inventory-units/GSA-002/2025-12.json'
import units003m202507 from '@/generated/dashboard/datasets/inventory-units/GSA-003/2025-07.json'
import units003m202508 from '@/generated/dashboard/datasets/inventory-units/GSA-003/2025-08.json'
import units003m202509 from '@/generated/dashboard/datasets/inventory-units/GSA-003/2025-09.json'
import units003m202510 from '@/generated/dashboard/datasets/inventory-units/GSA-003/2025-10.json'
import units003m202511 from '@/generated/dashboard/datasets/inventory-units/GSA-003/2025-11.json'
import units003m202512 from '@/generated/dashboard/datasets/inventory-units/GSA-003/2025-12.json'

/** The partition key the manifest and this table agree on. */
export function inventoryUnitChunkKey(dealershipId: string, month: string): string {
  return `${dealershipId}/${month}`
}

const INVENTORY_UNIT_CHUNKS: Readonly<Record<string, unknown>> = {
  'GSA-001/2025-07': units001m202507,
  'GSA-001/2025-08': units001m202508,
  'GSA-001/2025-09': units001m202509,
  'GSA-001/2025-10': units001m202510,
  'GSA-001/2025-11': units001m202511,
  'GSA-001/2025-12': units001m202512,
  'GSA-002/2025-07': units002m202507,
  'GSA-002/2025-08': units002m202508,
  'GSA-002/2025-09': units002m202509,
  'GSA-002/2025-10': units002m202510,
  'GSA-002/2025-11': units002m202511,
  'GSA-002/2025-12': units002m202512,
  'GSA-003/2025-07': units003m202507,
  'GSA-003/2025-08': units003m202508,
  'GSA-003/2025-09': units003m202509,
  'GSA-003/2025-10': units003m202510,
  'GSA-003/2025-11': units003m202511,
  'GSA-003/2025-12': units003m202512,
}

/** A partition, or `undefined` when the export does not carry that store-month. */
export function inventoryUnitChunkFile(
  dealershipId: string,
  month: string
): DashboardDatasetFile | undefined {
  const file = INVENTORY_UNIT_CHUNKS[inventoryUnitChunkKey(dealershipId, month)]
  return file === undefined ? undefined : (file as unknown as DashboardDatasetFile)
}

/** Every partition key this table carries, so a test can compare it to the manifest. */
export function inventoryUnitChunkKeys(): readonly string[] {
  return Object.keys(INVENTORY_UNIT_CHUNKS)
}
