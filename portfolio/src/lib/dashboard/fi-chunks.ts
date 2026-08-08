/**
 * The F&I partition tables: product penetration and deal product detail.
 *
 * WHY A FOURTH PARTITION MODULE
 * -----------------------------
 * The reason `jacket-chunks.ts` records, applied twice more. An import is a graph edge,
 * and the bundler inlines a file into a route's server chunk whether or not anything
 * reads it. These two datasets belong to two DIFFERENT routes:
 *
 *   fi-product-penetration   759 kB over 18 partitions   /dashboard/fi
 *   deal-product-detail      363 kB over 18 partitions   /dashboard/deals/[saleId]
 *
 * Putting either in `chunks.ts` would place it into the Executive Overview's graph, which
 * shows neither. They share this module because they share the partition KEY and the
 * lookup shape, and `tests/unit/dashboard-boundaries.test.ts` asserts which route reaches
 * which function.
 *
 * THE PARTITION KEY IS THE SALE MONTH, FOR BOTH
 * ---------------------------------------------
 * `deal-product-detail` partitions by store and SALE month deliberately: it is the same
 * key `deal-jacket` uses, so opening one jacket resolves one product partition and it is
 * the one the page already opened for the deal row. A contract's own adjustment dates are
 * a different question and are never the partition key.
 *
 * WHY STATIC IMPORTS RATHER THAN A FILE-SYSTEM READ
 * -------------------------------------------------
 * `next.config.ts` records what the alternative cost: a path built from `process.cwd()`
 * defeated the output tracer, which failed safe by copying the whole working directory
 * into `.next/standalone`. A static import is a graph edge the tracer resolves.
 *
 * SERVER ONLY.
 */
import type { DashboardDatasetFile } from '@/types/dashboard'

import pen001m202507 from '@/generated/dashboard/datasets/fi-product-penetration/GSA-001/2025-07.json'
import pen001m202508 from '@/generated/dashboard/datasets/fi-product-penetration/GSA-001/2025-08.json'
import pen001m202509 from '@/generated/dashboard/datasets/fi-product-penetration/GSA-001/2025-09.json'
import pen001m202510 from '@/generated/dashboard/datasets/fi-product-penetration/GSA-001/2025-10.json'
import pen001m202511 from '@/generated/dashboard/datasets/fi-product-penetration/GSA-001/2025-11.json'
import pen001m202512 from '@/generated/dashboard/datasets/fi-product-penetration/GSA-001/2025-12.json'
import pen002m202507 from '@/generated/dashboard/datasets/fi-product-penetration/GSA-002/2025-07.json'
import pen002m202508 from '@/generated/dashboard/datasets/fi-product-penetration/GSA-002/2025-08.json'
import pen002m202509 from '@/generated/dashboard/datasets/fi-product-penetration/GSA-002/2025-09.json'
import pen002m202510 from '@/generated/dashboard/datasets/fi-product-penetration/GSA-002/2025-10.json'
import pen002m202511 from '@/generated/dashboard/datasets/fi-product-penetration/GSA-002/2025-11.json'
import pen002m202512 from '@/generated/dashboard/datasets/fi-product-penetration/GSA-002/2025-12.json'
import pen003m202507 from '@/generated/dashboard/datasets/fi-product-penetration/GSA-003/2025-07.json'
import pen003m202508 from '@/generated/dashboard/datasets/fi-product-penetration/GSA-003/2025-08.json'
import pen003m202509 from '@/generated/dashboard/datasets/fi-product-penetration/GSA-003/2025-09.json'
import pen003m202510 from '@/generated/dashboard/datasets/fi-product-penetration/GSA-003/2025-10.json'
import pen003m202511 from '@/generated/dashboard/datasets/fi-product-penetration/GSA-003/2025-11.json'
import pen003m202512 from '@/generated/dashboard/datasets/fi-product-penetration/GSA-003/2025-12.json'
import prod001m202507 from '@/generated/dashboard/datasets/deal-product-detail/GSA-001/2025-07.json'
import prod001m202508 from '@/generated/dashboard/datasets/deal-product-detail/GSA-001/2025-08.json'
import prod001m202509 from '@/generated/dashboard/datasets/deal-product-detail/GSA-001/2025-09.json'
import prod001m202510 from '@/generated/dashboard/datasets/deal-product-detail/GSA-001/2025-10.json'
import prod001m202511 from '@/generated/dashboard/datasets/deal-product-detail/GSA-001/2025-11.json'
import prod001m202512 from '@/generated/dashboard/datasets/deal-product-detail/GSA-001/2025-12.json'
import prod002m202507 from '@/generated/dashboard/datasets/deal-product-detail/GSA-002/2025-07.json'
import prod002m202508 from '@/generated/dashboard/datasets/deal-product-detail/GSA-002/2025-08.json'
import prod002m202509 from '@/generated/dashboard/datasets/deal-product-detail/GSA-002/2025-09.json'
import prod002m202510 from '@/generated/dashboard/datasets/deal-product-detail/GSA-002/2025-10.json'
import prod002m202511 from '@/generated/dashboard/datasets/deal-product-detail/GSA-002/2025-11.json'
import prod002m202512 from '@/generated/dashboard/datasets/deal-product-detail/GSA-002/2025-12.json'
import prod003m202507 from '@/generated/dashboard/datasets/deal-product-detail/GSA-003/2025-07.json'
import prod003m202508 from '@/generated/dashboard/datasets/deal-product-detail/GSA-003/2025-08.json'
import prod003m202509 from '@/generated/dashboard/datasets/deal-product-detail/GSA-003/2025-09.json'
import prod003m202510 from '@/generated/dashboard/datasets/deal-product-detail/GSA-003/2025-10.json'
import prod003m202511 from '@/generated/dashboard/datasets/deal-product-detail/GSA-003/2025-11.json'
import prod003m202512 from '@/generated/dashboard/datasets/deal-product-detail/GSA-003/2025-12.json'

/** The partition key the manifest and these tables agree on. */
export function fiChunkKey(dealershipId: string, month: string): string {
  return `${dealershipId}/${month}`
}

const PENETRATION_CHUNKS: Readonly<Record<string, unknown>> = {
  'GSA-001/2025-07': pen001m202507,
  'GSA-001/2025-08': pen001m202508,
  'GSA-001/2025-09': pen001m202509,
  'GSA-001/2025-10': pen001m202510,
  'GSA-001/2025-11': pen001m202511,
  'GSA-001/2025-12': pen001m202512,
  'GSA-002/2025-07': pen002m202507,
  'GSA-002/2025-08': pen002m202508,
  'GSA-002/2025-09': pen002m202509,
  'GSA-002/2025-10': pen002m202510,
  'GSA-002/2025-11': pen002m202511,
  'GSA-002/2025-12': pen002m202512,
  'GSA-003/2025-07': pen003m202507,
  'GSA-003/2025-08': pen003m202508,
  'GSA-003/2025-09': pen003m202509,
  'GSA-003/2025-10': pen003m202510,
  'GSA-003/2025-11': pen003m202511,
  'GSA-003/2025-12': pen003m202512,
}

const PRODUCT_DETAIL_CHUNKS: Readonly<Record<string, unknown>> = {
  'GSA-001/2025-07': prod001m202507,
  'GSA-001/2025-08': prod001m202508,
  'GSA-001/2025-09': prod001m202509,
  'GSA-001/2025-10': prod001m202510,
  'GSA-001/2025-11': prod001m202511,
  'GSA-001/2025-12': prod001m202512,
  'GSA-002/2025-07': prod002m202507,
  'GSA-002/2025-08': prod002m202508,
  'GSA-002/2025-09': prod002m202509,
  'GSA-002/2025-10': prod002m202510,
  'GSA-002/2025-11': prod002m202511,
  'GSA-002/2025-12': prod002m202512,
  'GSA-003/2025-07': prod003m202507,
  'GSA-003/2025-08': prod003m202508,
  'GSA-003/2025-09': prod003m202509,
  'GSA-003/2025-10': prod003m202510,
  'GSA-003/2025-11': prod003m202511,
  'GSA-003/2025-12': prod003m202512,
}

/** One penetration partition, or `undefined` when the export does not carry it. */
export function penetrationChunkFile(
  dealershipId: string,
  month: string
): DashboardDatasetFile | undefined {
  const file = PENETRATION_CHUNKS[fiChunkKey(dealershipId, month)]
  return file === undefined ? undefined : (file as unknown as DashboardDatasetFile)
}

/** Every penetration partition key, so a test can compare it to the manifest. */
export function penetrationChunkKeys(): readonly string[] {
  return Object.keys(PENETRATION_CHUNKS)
}

/** Every penetration partition. The F&I page reads a period, not a single month. */
export function allPenetrationChunks(): readonly DashboardDatasetFile[] {
  return Object.values(PENETRATION_CHUNKS) as unknown as DashboardDatasetFile[]
}

/**
 * One deal-product-detail partition.
 *
 * The Deal Jacket resolves exactly one of these, from the store and sale month it already
 * knows -- never all eighteen. A deal that carried no contract resolves a partition that
 * simply holds no row for its `sale_id`, which is a legitimate and common outcome.
 */
export function productDetailChunkFile(
  dealershipId: string,
  month: string
): DashboardDatasetFile | undefined {
  const file = PRODUCT_DETAIL_CHUNKS[fiChunkKey(dealershipId, month)]
  return file === undefined ? undefined : (file as unknown as DashboardDatasetFile)
}

/** Every product-detail partition key, for the manifest comparison. */
export function productDetailChunkKeys(): readonly string[] {
  return Object.keys(PRODUCT_DETAIL_CHUNKS)
}
