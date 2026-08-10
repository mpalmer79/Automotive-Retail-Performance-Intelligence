/**
 * The two DASH.11 partition tables: every store x month, imported statically.
 *
 * WHY THIS IS A SEPARATE MODULE
 * ------------------------------
 * A module boundary is the only thing that actually enforces route scoping, because an
 * import is a graph edge whether or not the importing page renders a single field from it.
 * `employee-lead-source` alone is 522 kB of generated response bins; putting it in
 * `chunks.ts` would hand it to `/dashboard`, `/dashboard/deals` and every other route that
 * imports that file and reads no employee figure at all. These partitions live here and only
 * `/dashboard/employees` imports this file, through `employees-data.ts`.
 *
 * WHY STATIC IMPORTS RATHER THAN A FILE-SYSTEM READ
 * -------------------------------------------------
 * The same reason `chunks.ts`, `deal-chunks.ts`, `inventory-chunks.ts` and
 * `leads-marketing-chunks.ts` give: a server component that builds a path from
 * `process.cwd()` defeats the output tracer, which fails safe by copying the whole working
 * directory into `.next/standalone`. A static import is a graph edge the tracer resolves
 * exactly.
 *
 * ONE KEY PER PHYSICAL FILE. Each table is keyed `store/month` and each accessor is passed a
 * distinct cache key by `employees-data.ts`, prefixed with the dataset name. Two partitions
 * decoded under one key is not a hypothetical: it shipped twice in this project, once on
 * `/dashboard/inventory`, which rendered one store's 96 units three times and reported 288.
 * The failure is quiet by construction -- every partition has the same columns and the same
 * shape, so a shared key returns the first partition for every store and month and the page
 * looks entirely reasonable while being wrong. `decodeDataset` throws on a key collision now,
 * and `dashboard-employees.test.ts` asserts these two tables cannot collide with each other.
 *
 * SERVER ONLY. A `'use client'` module importing this would ship every partition to a browser.
 */
import type { DashboardDatasetFile } from '@/types/dashboard'

import sale001m202507 from '@/generated/dashboard/datasets/employee-sales/GSA-001/2025-07.json'
import sale001m202508 from '@/generated/dashboard/datasets/employee-sales/GSA-001/2025-08.json'
import sale001m202509 from '@/generated/dashboard/datasets/employee-sales/GSA-001/2025-09.json'
import sale001m202510 from '@/generated/dashboard/datasets/employee-sales/GSA-001/2025-10.json'
import sale001m202511 from '@/generated/dashboard/datasets/employee-sales/GSA-001/2025-11.json'
import sale001m202512 from '@/generated/dashboard/datasets/employee-sales/GSA-001/2025-12.json'
import sale002m202507 from '@/generated/dashboard/datasets/employee-sales/GSA-002/2025-07.json'
import sale002m202508 from '@/generated/dashboard/datasets/employee-sales/GSA-002/2025-08.json'
import sale002m202509 from '@/generated/dashboard/datasets/employee-sales/GSA-002/2025-09.json'
import sale002m202510 from '@/generated/dashboard/datasets/employee-sales/GSA-002/2025-10.json'
import sale002m202511 from '@/generated/dashboard/datasets/employee-sales/GSA-002/2025-11.json'
import sale002m202512 from '@/generated/dashboard/datasets/employee-sales/GSA-002/2025-12.json'
import sale003m202507 from '@/generated/dashboard/datasets/employee-sales/GSA-003/2025-07.json'
import sale003m202508 from '@/generated/dashboard/datasets/employee-sales/GSA-003/2025-08.json'
import sale003m202509 from '@/generated/dashboard/datasets/employee-sales/GSA-003/2025-09.json'
import sale003m202510 from '@/generated/dashboard/datasets/employee-sales/GSA-003/2025-10.json'
import sale003m202511 from '@/generated/dashboard/datasets/employee-sales/GSA-003/2025-11.json'
import sale003m202512 from '@/generated/dashboard/datasets/employee-sales/GSA-003/2025-12.json'
import src001m202507 from '@/generated/dashboard/datasets/employee-lead-source/GSA-001/2025-07.json'
import src001m202508 from '@/generated/dashboard/datasets/employee-lead-source/GSA-001/2025-08.json'
import src001m202509 from '@/generated/dashboard/datasets/employee-lead-source/GSA-001/2025-09.json'
import src001m202510 from '@/generated/dashboard/datasets/employee-lead-source/GSA-001/2025-10.json'
import src001m202511 from '@/generated/dashboard/datasets/employee-lead-source/GSA-001/2025-11.json'
import src001m202512 from '@/generated/dashboard/datasets/employee-lead-source/GSA-001/2025-12.json'
import src002m202507 from '@/generated/dashboard/datasets/employee-lead-source/GSA-002/2025-07.json'
import src002m202508 from '@/generated/dashboard/datasets/employee-lead-source/GSA-002/2025-08.json'
import src002m202509 from '@/generated/dashboard/datasets/employee-lead-source/GSA-002/2025-09.json'
import src002m202510 from '@/generated/dashboard/datasets/employee-lead-source/GSA-002/2025-10.json'
import src002m202511 from '@/generated/dashboard/datasets/employee-lead-source/GSA-002/2025-11.json'
import src002m202512 from '@/generated/dashboard/datasets/employee-lead-source/GSA-002/2025-12.json'
import src003m202507 from '@/generated/dashboard/datasets/employee-lead-source/GSA-003/2025-07.json'
import src003m202508 from '@/generated/dashboard/datasets/employee-lead-source/GSA-003/2025-08.json'
import src003m202509 from '@/generated/dashboard/datasets/employee-lead-source/GSA-003/2025-09.json'
import src003m202510 from '@/generated/dashboard/datasets/employee-lead-source/GSA-003/2025-10.json'
import src003m202511 from '@/generated/dashboard/datasets/employee-lead-source/GSA-003/2025-11.json'
import src003m202512 from '@/generated/dashboard/datasets/employee-lead-source/GSA-003/2025-12.json'

/** The partition key both tables use. One key per physical file, always. */
function employeesChunkKey(dealershipId: string, month: string): string {
  return `${dealershipId}/${month}`
}

const EMPLOYEE_SALES_CHUNKS: Readonly<Record<string, unknown>> = {
  'GSA-001/2025-07': sale001m202507,
  'GSA-001/2025-08': sale001m202508,
  'GSA-001/2025-09': sale001m202509,
  'GSA-001/2025-10': sale001m202510,
  'GSA-001/2025-11': sale001m202511,
  'GSA-001/2025-12': sale001m202512,
  'GSA-002/2025-07': sale002m202507,
  'GSA-002/2025-08': sale002m202508,
  'GSA-002/2025-09': sale002m202509,
  'GSA-002/2025-10': sale002m202510,
  'GSA-002/2025-11': sale002m202511,
  'GSA-002/2025-12': sale002m202512,
  'GSA-003/2025-07': sale003m202507,
  'GSA-003/2025-08': sale003m202508,
  'GSA-003/2025-09': sale003m202509,
  'GSA-003/2025-10': sale003m202510,
  'GSA-003/2025-11': sale003m202511,
  'GSA-003/2025-12': sale003m202512,
}

/** An `employee-sales` partition, or `undefined` when the export carries no such store-month. */
export function employeeSalesChunkFile(
  dealershipId: string,
  month: string
): DashboardDatasetFile | undefined {
  const file = EMPLOYEE_SALES_CHUNKS[employeesChunkKey(dealershipId, month)]
  return file === undefined ? undefined : (file as unknown as DashboardDatasetFile)
}

const EMPLOYEE_LEAD_SOURCE_CHUNKS: Readonly<Record<string, unknown>> = {
  'GSA-001/2025-07': src001m202507,
  'GSA-001/2025-08': src001m202508,
  'GSA-001/2025-09': src001m202509,
  'GSA-001/2025-10': src001m202510,
  'GSA-001/2025-11': src001m202511,
  'GSA-001/2025-12': src001m202512,
  'GSA-002/2025-07': src002m202507,
  'GSA-002/2025-08': src002m202508,
  'GSA-002/2025-09': src002m202509,
  'GSA-002/2025-10': src002m202510,
  'GSA-002/2025-11': src002m202511,
  'GSA-002/2025-12': src002m202512,
  'GSA-003/2025-07': src003m202507,
  'GSA-003/2025-08': src003m202508,
  'GSA-003/2025-09': src003m202509,
  'GSA-003/2025-10': src003m202510,
  'GSA-003/2025-11': src003m202511,
  'GSA-003/2025-12': src003m202512,
}

/** An `employee-lead-source` partition, or `undefined` when the export carries no such store-month. */
export function employeeLeadSourceChunkFile(
  dealershipId: string,
  month: string
): DashboardDatasetFile | undefined {
  const file = EMPLOYEE_LEAD_SOURCE_CHUNKS[employeesChunkKey(dealershipId, month)]
  return file === undefined ? undefined : (file as unknown as DashboardDatasetFile)
}

/** Every partition key each table carries, so a test can compare them to the manifest. */
export function employeesChunkKeys(): Readonly<Record<string, readonly string[]>> {
  return {
    'employee-sales': Object.keys(EMPLOYEE_SALES_CHUNKS),
    'employee-lead-source': Object.keys(EMPLOYEE_LEAD_SOURCE_CHUNKS),
  }
}
