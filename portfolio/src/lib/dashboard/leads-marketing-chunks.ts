/**
 * The three DASH.10 partition tables: every store x month, imported statically.
 *
 * WHY THIS IS A SEPARATE MODULE
 * ------------------------------
 * `chunks.ts` holds the five aggregate partitions the Executive Overview reads, and these
 * three are not among them. `/dashboard` renders a lead funnel, so it might look like a
 * candidate for the stage-loss or response partitions -- it is not: it reads `lead-funnel`
 * and nothing else, and an import here would pull 951 kB of BDC and response detail into
 * the server graph of every route that imports `chunks.ts`.
 *
 * A module boundary is the only thing that actually enforces route scoping, because an
 * import is a graph edge whether or not the importing page renders a single field from it.
 * These partitions live here and only `/dashboard/leads-marketing` imports this file,
 * through `leads-marketing-data.ts`.
 *
 * WHY STATIC IMPORTS RATHER THAN A FILE-SYSTEM READ
 * -------------------------------------------------
 * The same reason `chunks.ts`, `deal-chunks.ts` and `inventory-chunks.ts` give: a server
 * component that builds a path from `process.cwd()` defeats the output tracer, which fails
 * safe by copying the whole working directory into `.next/standalone`. A static import is a
 * graph edge the tracer resolves exactly.
 *
 * ONE KEY PER PHYSICAL FILE. Each table is keyed `store/month` and each accessor is passed
 * a distinct cache key by `leads-marketing-data.ts`, prefixed with the dataset name. Two
 * partitions decoded under one key is not a hypothetical: it shipped on `/dashboard/
 * inventory`, which rendered one store's 96 units three times and reported 288. `decodeDataset`
 * throws on a key collision now, and `leads-marketing.test.ts` asserts these three cannot
 * collide with each other.
 *
 * SERVER ONLY. A `'use client'` module importing this would ship every partition to a browser.
 */
import type { DashboardDatasetFile } from '@/types/dashboard'

import appt001m202507 from '@/generated/dashboard/datasets/appointment-source-funnel/GSA-001/2025-07.json'
import appt001m202508 from '@/generated/dashboard/datasets/appointment-source-funnel/GSA-001/2025-08.json'
import appt001m202509 from '@/generated/dashboard/datasets/appointment-source-funnel/GSA-001/2025-09.json'
import appt001m202510 from '@/generated/dashboard/datasets/appointment-source-funnel/GSA-001/2025-10.json'
import appt001m202511 from '@/generated/dashboard/datasets/appointment-source-funnel/GSA-001/2025-11.json'
import appt001m202512 from '@/generated/dashboard/datasets/appointment-source-funnel/GSA-001/2025-12.json'
import appt002m202507 from '@/generated/dashboard/datasets/appointment-source-funnel/GSA-002/2025-07.json'
import appt002m202508 from '@/generated/dashboard/datasets/appointment-source-funnel/GSA-002/2025-08.json'
import appt002m202509 from '@/generated/dashboard/datasets/appointment-source-funnel/GSA-002/2025-09.json'
import appt002m202510 from '@/generated/dashboard/datasets/appointment-source-funnel/GSA-002/2025-10.json'
import appt002m202511 from '@/generated/dashboard/datasets/appointment-source-funnel/GSA-002/2025-11.json'
import appt002m202512 from '@/generated/dashboard/datasets/appointment-source-funnel/GSA-002/2025-12.json'
import appt003m202507 from '@/generated/dashboard/datasets/appointment-source-funnel/GSA-003/2025-07.json'
import appt003m202508 from '@/generated/dashboard/datasets/appointment-source-funnel/GSA-003/2025-08.json'
import appt003m202509 from '@/generated/dashboard/datasets/appointment-source-funnel/GSA-003/2025-09.json'
import appt003m202510 from '@/generated/dashboard/datasets/appointment-source-funnel/GSA-003/2025-10.json'
import appt003m202511 from '@/generated/dashboard/datasets/appointment-source-funnel/GSA-003/2025-11.json'
import appt003m202512 from '@/generated/dashboard/datasets/appointment-source-funnel/GSA-003/2025-12.json'
import loss001m202507 from '@/generated/dashboard/datasets/lead-stage-loss/GSA-001/2025-07.json'
import loss001m202508 from '@/generated/dashboard/datasets/lead-stage-loss/GSA-001/2025-08.json'
import loss001m202509 from '@/generated/dashboard/datasets/lead-stage-loss/GSA-001/2025-09.json'
import loss001m202510 from '@/generated/dashboard/datasets/lead-stage-loss/GSA-001/2025-10.json'
import loss001m202511 from '@/generated/dashboard/datasets/lead-stage-loss/GSA-001/2025-11.json'
import loss001m202512 from '@/generated/dashboard/datasets/lead-stage-loss/GSA-001/2025-12.json'
import loss002m202507 from '@/generated/dashboard/datasets/lead-stage-loss/GSA-002/2025-07.json'
import loss002m202508 from '@/generated/dashboard/datasets/lead-stage-loss/GSA-002/2025-08.json'
import loss002m202509 from '@/generated/dashboard/datasets/lead-stage-loss/GSA-002/2025-09.json'
import loss002m202510 from '@/generated/dashboard/datasets/lead-stage-loss/GSA-002/2025-10.json'
import loss002m202511 from '@/generated/dashboard/datasets/lead-stage-loss/GSA-002/2025-11.json'
import loss002m202512 from '@/generated/dashboard/datasets/lead-stage-loss/GSA-002/2025-12.json'
import loss003m202507 from '@/generated/dashboard/datasets/lead-stage-loss/GSA-003/2025-07.json'
import loss003m202508 from '@/generated/dashboard/datasets/lead-stage-loss/GSA-003/2025-08.json'
import loss003m202509 from '@/generated/dashboard/datasets/lead-stage-loss/GSA-003/2025-09.json'
import loss003m202510 from '@/generated/dashboard/datasets/lead-stage-loss/GSA-003/2025-10.json'
import loss003m202511 from '@/generated/dashboard/datasets/lead-stage-loss/GSA-003/2025-11.json'
import loss003m202512 from '@/generated/dashboard/datasets/lead-stage-loss/GSA-003/2025-12.json'
import dist001m202507 from '@/generated/dashboard/datasets/lead-response-distribution/GSA-001/2025-07.json'
import dist001m202508 from '@/generated/dashboard/datasets/lead-response-distribution/GSA-001/2025-08.json'
import dist001m202509 from '@/generated/dashboard/datasets/lead-response-distribution/GSA-001/2025-09.json'
import dist001m202510 from '@/generated/dashboard/datasets/lead-response-distribution/GSA-001/2025-10.json'
import dist001m202511 from '@/generated/dashboard/datasets/lead-response-distribution/GSA-001/2025-11.json'
import dist001m202512 from '@/generated/dashboard/datasets/lead-response-distribution/GSA-001/2025-12.json'
import dist002m202507 from '@/generated/dashboard/datasets/lead-response-distribution/GSA-002/2025-07.json'
import dist002m202508 from '@/generated/dashboard/datasets/lead-response-distribution/GSA-002/2025-08.json'
import dist002m202509 from '@/generated/dashboard/datasets/lead-response-distribution/GSA-002/2025-09.json'
import dist002m202510 from '@/generated/dashboard/datasets/lead-response-distribution/GSA-002/2025-10.json'
import dist002m202511 from '@/generated/dashboard/datasets/lead-response-distribution/GSA-002/2025-11.json'
import dist002m202512 from '@/generated/dashboard/datasets/lead-response-distribution/GSA-002/2025-12.json'
import dist003m202507 from '@/generated/dashboard/datasets/lead-response-distribution/GSA-003/2025-07.json'
import dist003m202508 from '@/generated/dashboard/datasets/lead-response-distribution/GSA-003/2025-08.json'
import dist003m202509 from '@/generated/dashboard/datasets/lead-response-distribution/GSA-003/2025-09.json'
import dist003m202510 from '@/generated/dashboard/datasets/lead-response-distribution/GSA-003/2025-10.json'
import dist003m202511 from '@/generated/dashboard/datasets/lead-response-distribution/GSA-003/2025-11.json'
import dist003m202512 from '@/generated/dashboard/datasets/lead-response-distribution/GSA-003/2025-12.json'

/** The partition key the manifest and these tables agree on. */
export function leadsMarketingChunkKey(dealershipId: string, month: string): string {
  return `${dealershipId}/${month}`
}

const APPOINTMENT_SOURCE_CHUNKS: Readonly<Record<string, unknown>> = {
  'GSA-001/2025-07': appt001m202507,
  'GSA-001/2025-08': appt001m202508,
  'GSA-001/2025-09': appt001m202509,
  'GSA-001/2025-10': appt001m202510,
  'GSA-001/2025-11': appt001m202511,
  'GSA-001/2025-12': appt001m202512,
  'GSA-002/2025-07': appt002m202507,
  'GSA-002/2025-08': appt002m202508,
  'GSA-002/2025-09': appt002m202509,
  'GSA-002/2025-10': appt002m202510,
  'GSA-002/2025-11': appt002m202511,
  'GSA-002/2025-12': appt002m202512,
  'GSA-003/2025-07': appt003m202507,
  'GSA-003/2025-08': appt003m202508,
  'GSA-003/2025-09': appt003m202509,
  'GSA-003/2025-10': appt003m202510,
  'GSA-003/2025-11': appt003m202511,
  'GSA-003/2025-12': appt003m202512,
}

/** A `appointment-source-funnel` partition, or `undefined` when the export carries no such store-month. */
export function appointmentSourceChunkFile(
  dealershipId: string,
  month: string
): DashboardDatasetFile | undefined {
  const file = APPOINTMENT_SOURCE_CHUNKS[leadsMarketingChunkKey(dealershipId, month)]
  return file === undefined ? undefined : (file as unknown as DashboardDatasetFile)
}

const LEAD_STAGE_LOSS_CHUNKS: Readonly<Record<string, unknown>> = {
  'GSA-001/2025-07': loss001m202507,
  'GSA-001/2025-08': loss001m202508,
  'GSA-001/2025-09': loss001m202509,
  'GSA-001/2025-10': loss001m202510,
  'GSA-001/2025-11': loss001m202511,
  'GSA-001/2025-12': loss001m202512,
  'GSA-002/2025-07': loss002m202507,
  'GSA-002/2025-08': loss002m202508,
  'GSA-002/2025-09': loss002m202509,
  'GSA-002/2025-10': loss002m202510,
  'GSA-002/2025-11': loss002m202511,
  'GSA-002/2025-12': loss002m202512,
  'GSA-003/2025-07': loss003m202507,
  'GSA-003/2025-08': loss003m202508,
  'GSA-003/2025-09': loss003m202509,
  'GSA-003/2025-10': loss003m202510,
  'GSA-003/2025-11': loss003m202511,
  'GSA-003/2025-12': loss003m202512,
}

/** A `lead-stage-loss` partition, or `undefined` when the export carries no such store-month. */
export function leadStageLossChunkFile(
  dealershipId: string,
  month: string
): DashboardDatasetFile | undefined {
  const file = LEAD_STAGE_LOSS_CHUNKS[leadsMarketingChunkKey(dealershipId, month)]
  return file === undefined ? undefined : (file as unknown as DashboardDatasetFile)
}

const RESPONSE_DISTRIBUTION_CHUNKS: Readonly<Record<string, unknown>> = {
  'GSA-001/2025-07': dist001m202507,
  'GSA-001/2025-08': dist001m202508,
  'GSA-001/2025-09': dist001m202509,
  'GSA-001/2025-10': dist001m202510,
  'GSA-001/2025-11': dist001m202511,
  'GSA-001/2025-12': dist001m202512,
  'GSA-002/2025-07': dist002m202507,
  'GSA-002/2025-08': dist002m202508,
  'GSA-002/2025-09': dist002m202509,
  'GSA-002/2025-10': dist002m202510,
  'GSA-002/2025-11': dist002m202511,
  'GSA-002/2025-12': dist002m202512,
  'GSA-003/2025-07': dist003m202507,
  'GSA-003/2025-08': dist003m202508,
  'GSA-003/2025-09': dist003m202509,
  'GSA-003/2025-10': dist003m202510,
  'GSA-003/2025-11': dist003m202511,
  'GSA-003/2025-12': dist003m202512,
}

/** A `lead-response-distribution` partition, or `undefined` when the export carries no such store-month. */
export function responseDistributionChunkFile(
  dealershipId: string,
  month: string
): DashboardDatasetFile | undefined {
  const file = RESPONSE_DISTRIBUTION_CHUNKS[leadsMarketingChunkKey(dealershipId, month)]
  return file === undefined ? undefined : (file as unknown as DashboardDatasetFile)
}

/** Every partition key each table carries, so a test can compare them to the manifest. */
export function leadsMarketingChunkKeys(): Readonly<Record<string, readonly string[]>> {
  return {
    'appointment-source-funnel': Object.keys(APPOINTMENT_SOURCE_CHUNKS),
    'lead-stage-loss': Object.keys(LEAD_STAGE_LOSS_CHUNKS),
    'lead-response-distribution': Object.keys(RESPONSE_DISTRIBUTION_CHUNKS),
  }
}
