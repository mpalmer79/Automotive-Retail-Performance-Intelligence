/**
 * The accounting-schedule partition table: every store x accounting month, imported statically.
 *
 * WHY THIS IS A SEPARATE MODULE
 * ------------------------------
 * The stock schedule is unit-level accounting detail, and only the accounting and
 * inventory surfaces have any business holding it. `/dashboard` renders a single
 * reconciliation figure and must not import 360 kB of per-unit book values to do it --
 * `tests/unit/dashboard-boundaries.test.ts` asserts the importer set.
 *
 * It is kept apart from `inventory-chunks.ts` for the same reason: the two share a grain
 * but not an audience, and a route that wants operational stock should not acquire every
 * capitalised cost component as a side effect.
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

import acct001m202507 from '@/generated/dashboard/datasets/inventory-accounting/GSA-001/2025-07.json'
import acct001m202508 from '@/generated/dashboard/datasets/inventory-accounting/GSA-001/2025-08.json'
import acct001m202509 from '@/generated/dashboard/datasets/inventory-accounting/GSA-001/2025-09.json'
import acct001m202510 from '@/generated/dashboard/datasets/inventory-accounting/GSA-001/2025-10.json'
import acct001m202511 from '@/generated/dashboard/datasets/inventory-accounting/GSA-001/2025-11.json'
import acct001m202512 from '@/generated/dashboard/datasets/inventory-accounting/GSA-001/2025-12.json'
import acct002m202507 from '@/generated/dashboard/datasets/inventory-accounting/GSA-002/2025-07.json'
import acct002m202508 from '@/generated/dashboard/datasets/inventory-accounting/GSA-002/2025-08.json'
import acct002m202509 from '@/generated/dashboard/datasets/inventory-accounting/GSA-002/2025-09.json'
import acct002m202510 from '@/generated/dashboard/datasets/inventory-accounting/GSA-002/2025-10.json'
import acct002m202511 from '@/generated/dashboard/datasets/inventory-accounting/GSA-002/2025-11.json'
import acct002m202512 from '@/generated/dashboard/datasets/inventory-accounting/GSA-002/2025-12.json'
import acct003m202507 from '@/generated/dashboard/datasets/inventory-accounting/GSA-003/2025-07.json'
import acct003m202508 from '@/generated/dashboard/datasets/inventory-accounting/GSA-003/2025-08.json'
import acct003m202509 from '@/generated/dashboard/datasets/inventory-accounting/GSA-003/2025-09.json'
import acct003m202510 from '@/generated/dashboard/datasets/inventory-accounting/GSA-003/2025-10.json'
import acct003m202511 from '@/generated/dashboard/datasets/inventory-accounting/GSA-003/2025-11.json'
import acct003m202512 from '@/generated/dashboard/datasets/inventory-accounting/GSA-003/2025-12.json'

/** The partition key the manifest and this table agree on. */
export function accountingChunkKey(dealershipId: string, month: string): string {
  return `${dealershipId}/${month}`
}

const ACCOUNTING_CHUNKS: Readonly<Record<string, unknown>> = {
  'GSA-001/2025-07': acct001m202507,
  'GSA-001/2025-08': acct001m202508,
  'GSA-001/2025-09': acct001m202509,
  'GSA-001/2025-10': acct001m202510,
  'GSA-001/2025-11': acct001m202511,
  'GSA-001/2025-12': acct001m202512,
  'GSA-002/2025-07': acct002m202507,
  'GSA-002/2025-08': acct002m202508,
  'GSA-002/2025-09': acct002m202509,
  'GSA-002/2025-10': acct002m202510,
  'GSA-002/2025-11': acct002m202511,
  'GSA-002/2025-12': acct002m202512,
  'GSA-003/2025-07': acct003m202507,
  'GSA-003/2025-08': acct003m202508,
  'GSA-003/2025-09': acct003m202509,
  'GSA-003/2025-10': acct003m202510,
  'GSA-003/2025-11': acct003m202511,
  'GSA-003/2025-12': acct003m202512,
}

/** A partition, or `undefined` when the export does not carry that store-month. */
export function accountingChunkFile(
  dealershipId: string,
  month: string
): DashboardDatasetFile | undefined {
  const file = ACCOUNTING_CHUNKS[accountingChunkKey(dealershipId, month)]
  return file === undefined ? undefined : (file as unknown as DashboardDatasetFile)
}

/** Every partition key this table carries, so a test can compare it to the manifest. */
export function accountingChunkKeys(): readonly string[] {
  return Object.keys(ACCOUNTING_CHUNKS)
}
