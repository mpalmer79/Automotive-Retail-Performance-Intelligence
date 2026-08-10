/**
 * The data door for `/dashboard/employees`, and nothing else reads it.
 *
 * WHY THIS EXISTS RATHER THAN FIVE MORE LINES IN `data.ts`
 * --------------------------------------------------------
 * `data.ts` is imported by every console route, so every import inside it is an edge in
 * every route's server graph — the bundler inlines the file whether or not anything reads a
 * field from it. This route needs `employees` (2 kB), `employee-finance` (43 kB),
 * `employee-appointments` (48 kB) and two partitioned datasets totalling 681 kB. Putting any
 * of that in `data.ts` would hand `/dashboard`, `/dashboard/deals` and five other pages
 * three-quarters of a megabyte of employee detail they have no business holding, which is the
 * shape `fi-data.ts`, `accounting-data.ts`, `sales-gross-data.ts`, `leads-marketing-data.ts`
 * and `inventory-chunks.ts` were each split out to avoid.
 *
 * WHAT IT DOES AND DOES NOT DO
 * ----------------------------
 * It decodes files and SELECTS rows. It adds nothing up. Every aggregation this route
 * performs is declared in `employees.ts` against the export's governed columns, for the
 * reason ADR-0013 condition 2 gives: a helper here that happened to sum a column would be the
 * first step toward a second KPI engine.
 *
 * It also sorts nothing by a measure, and cannot: the rows arrive in the export's own order —
 * store, date, role family, employee code — and `employees.ts` orders the comparison list by
 * store, role and code. A list sorted descending by gross is a leaderboard whether or not the
 * word "rank" appears anywhere near it, and the absence of a sort helper here is part of why
 * one cannot be introduced by accident.
 *
 * WHAT IT DELIBERATELY DOES NOT OPEN
 * -----------------------------------
 * `inventory-health` is read through `inventory-chunks.ts` rather than re-imported here,
 * because the store inventory context this route shows is the SAME governed figure
 * `/dashboard/inventory` publishes and must not become a second one. It is store context, not
 * an employee measure: no employee row carries it, so nothing can sum it across people.
 *
 * ONE CACHE KEY PER PHYSICAL FILE
 * -------------------------------
 * Every `decodeDataset` call below is passed a key prefixed with the dataset name and
 * suffixed with the partition, because a partitioned dataset needs one key per partition and
 * not one per dataset. The failure mode is not theoretical and not loud: every partition has
 * the same columns and the same shape, so a shared key returns the FIRST partition's rows for
 * every store and month, and the result looks entirely reasonable — right columns, plausible
 * counts, wrong store. That defect shipped twice in this project. `decodeDataset` throws on a
 * collision now, and `dashboard-employees.test.ts` asserts these datasets cannot share one.
 *
 * SERVER ONLY, like every module that touches the generated tree.
 */
import type { DashboardDatasetFile, DashboardRow } from '@/types/dashboard'

import appointmentsFile from '@/generated/dashboard/datasets/employee-appointments.json'
import financeFile from '@/generated/dashboard/datasets/employee-finance.json'
import employeesFile from '@/generated/dashboard/datasets/employees.json'

import { decodeDataset } from './data'
import { employeeLeadSourceChunkFile, employeeSalesChunkFile } from './employees-chunks'

/* -------------------------------------------------------------------------- */
/* Whole-file datasets                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The employee roster: code, store, department, role, manager flag, tenure band, active flag.
 *
 * THE CURRENT SCD TYPE 2 VERSION ONLY, which is what makes it a roster and not a history. Its
 * `is_active` is CURRENT ROSTER CONTEXT and never a historical filter: a person who has left
 * is still the person who sold the car, so nothing here may be used to drop a performance row
 * from a period that person worked in.
 *
 * Thirty rows and no personal data of any kind — no name, initial, photo, contact detail,
 * hire date, termination date, exact tenure, age, compensation or protected attribute, none
 * of which exists in the warehouse to export. `employee_code` is the only label, and it names
 * a fictional person.
 */
export function employeeRosterRows(): readonly DashboardRow[] {
  return decodeDataset('employees', employeesFile as unknown as DashboardDatasetFile)
}

/**
 * Finance-manager credit at store x sale date x employee, including the unstaffed group.
 *
 * `employee_code` null means NOBODY WAS ON THE F&I DESK — 135 real deliveries — and never
 * "manager unknown". The row is inside every store total and outside the employee comparison.
 *
 * `financed_retail_units` is the governed denominator of reserve PVR and back PVR and it
 * INCLUDES CASH DEALS, which cannot generate reserve. The three structure counts travel on
 * the same row so a different cash mix is visible as the explanation rather than being
 * mistaken for finance-office skill.
 */
export function employeeFinanceRows(): readonly DashboardRow[] {
  return decodeDataset('employee-finance', financeFile as unknown as DashboardDatasetFile)
}

/**
 * BDC appointment credit at store x date x employee.
 *
 * TWO DATE BASES TRAVEL ON ONE `activity_date` COLUMN: the eligibility, cancellation and
 * `..._scheduled_basis` columns are on the appointment's SCHEDULED date, the `..._show_basis`
 * and shown-and-sold columns on its SHOW date. Reading a period therefore collects rows on
 * both bases, which is correct — each column knows which basis it belongs to — and is why
 * `employees.ts` never sums across the two.
 *
 * APPOINTMENT GRAIN, not lead grain. One lead can produce several appointments, so these
 * denominators are not the lead denominators and the two must never share a funnel width.
 */
export function employeeAppointmentRows(): readonly DashboardRow[] {
  return decodeDataset(
    'employee-appointments',
    appointmentsFile as unknown as DashboardDatasetFile
  )
}

/* -------------------------------------------------------------------------- */
/* Partitioned datasets                                                        */
/* -------------------------------------------------------------------------- */

function collect(
  dataset: string,
  reader: (store: string, month: string) => DashboardDatasetFile | undefined,
  stores: readonly string[],
  months: readonly string[]
): readonly DashboardRow[] {
  const rows: DashboardRow[] = []
  for (const store of stores) {
    for (const month of months) {
      const file = reader(store, month)
      if (file === undefined) continue
      rows.push(...decodeDataset(`${dataset}/${store}/${month}`, file))
    }
  }
  return rows
}

/**
 * Salesperson and desk-manager credit at store x sale date x employee.
 *
 * TWO CREDITS ON ONE DELIVERY, in two separately named column groups. A car is credited to a
 * salesperson AND to a desk manager, so `sold_*` and `desked_*` are distinct columns rather
 * than one "retail units" column that `role_family` disambiguates: the shared design triples
 * every delivery for anything that sums across families. Each group therefore sums correctly
 * over the whole set with no family filter, which is what `RECON-EMP-SALES-UNITS` proves.
 *
 * The rows carry NO RATE. Gross per retail unit is `SUM(gross) / SUM(units)` computed once at
 * the grain being reported, never an average of the daily or per-employee ratios that would
 * be derivable if a rate were published here.
 */
export function employeeSalesRows(
  stores: readonly string[],
  months: readonly string[]
): readonly DashboardRow[] {
  return collect('employee-sales', employeeSalesChunkFile, stores, months)
}

/**
 * The assigned-lead population beneath the employee row, by source and by response bin.
 *
 * These are BINS, not leads. A row with `valid_lead_count` 1 is still a bin, and nothing may
 * render one as a lead: the dataset carries no lead key, lead code, customer, sale or vehicle,
 * and this route is not a CRM screen.
 *
 * `first_response_seconds` null is the NEVER-RESPONDED bin. It must be excluded from any order
 * statistic and must never be coalesced to zero — doing so would sort the ignored leads to the
 * fastest end and improve the median, which is precisely the failure this shape exists to make
 * impossible to hide. Zero seconds is a real instant response and an ordinary observation.
 *
 * This is also the ONLY place the lead funnel is published per employee. The sales, finance and
 * appointment datasets carry none of these columns, so no lead number here has a second
 * publisher that could disagree with it.
 */
export function employeeLeadSourceRows(
  stores: readonly string[],
  months: readonly string[]
): readonly DashboardRow[] {
  return collect('employee-lead-source', employeeLeadSourceChunkFile, stores, months)
}
