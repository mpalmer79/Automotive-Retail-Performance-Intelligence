/**
 * The analytical-scope vocabulary: one way to say which stores are in scope.
 *
 * WHAT `UX.2D` MEASURED, AND WHY THIS MODULE EXISTS
 * ------------------------------------------------
 * The scope line under every operating title is the one sentence a reader cannot
 * read a figure without. Nine routes wrote it nine ways. Loading each route with
 * `?store=GSA-002` on `main` at `9c109b67` produced, verbatim:
 *
 *   /                            Granite Subaru · December 2025 · vs November 2025
 *   /dashboard/sales-gross       Granite Subaru · December 2025 · vs November 2025
 *   /dashboard/deals             38 deals · Granite Subaru · December 2025
 *   /dashboard/fi                Granite Subaru · December 2025 · vs November 2025
 *   /dashboard/inventory         GSA-002 · Snapshot 31 December 2025 · Aged over 60 days
 *   /dashboard/leads-marketing   GSA-002 · December 2025
 *   /dashboard/employees         GSA-002 · December 2025 · Salesperson view
 *   /dashboard/accounting        GSA-002 · Position at 31 December 2025
 *   /dashboard/actions           GSA-002 · 47 open review prompts
 *
 * FIVE OF NINE ROUTES PRINTED THE WAREHOUSE KEY. `UX.2D` §9 is explicit — do not
 * expose an internal code where a public business label exists — and the label
 * existed: `dim_store.store_short_name` is in the same export those routes already
 * read, and the four routes that got it right were reading it through a selector
 * the other five did not call.
 *
 * The unfiltered line drifted in the same way and less visibly: "Granite Auto
 * Group, all three stores" on three routes, "All three stores" on four, "All
 * stores" on Inventory, and the lowercase fragment "the group" on F&I, which
 * rendered as `F&I | the group · December 2025` — a title case accident that reads
 * as an unfinished sentence.
 *
 * So the vocabulary is declared once, here, and the routes call it. There is no
 * new data, no new selector and no new query: this module maps store identifiers
 * that a route already holds onto the labels the store dimension already
 * publishes.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not decide what is in scope. `parseFilters` does that, and a module that
 * both resolved scope and named it would be a second place for the two to disagree.
 * It receives the resolved identifiers and returns words.
 *
 * Pure: no React, no `window`. It reads the store dimension, which is a server
 * module — `tests/unit/dashboard-boundaries.test.ts` asserts no client component
 * reaches one, so no client component may import this.
 */
import { dashboardStores, storeById } from './data'

/**
 * The whole group, in words.
 *
 * "All three stores", not "Granite Auto Group, all three stores": the group's name
 * is on the rail, in the document title and in the demo statement inside the
 * methodology summary, and a scope line that repeats it spends a third of a phone's
 * line width restating the one fact the reader cannot have lost.
 *
 * The count is written out rather than computed because it is a label, not a
 * figure — but `storeScopeLabel` still checks the dimension's length before using
 * it, so a fourth store would change the sentence rather than making it wrong.
 */
export const ALL_STORES_LABEL = 'All three stores'

/** The whole group, where the count is not three. */
function allStoresLabel(total: number): string {
  return total === 3 ? ALL_STORES_LABEL : `All ${String(total)} stores`
}

/**
 * The business name of one store, or the identifier when there is no such store.
 *
 * The fallback is the identifier ON PURPOSE. A code that reaches this function
 * without a matching dimension row is a data defect, and printing "Unknown store"
 * would hide which code it was from the person who has to fix it.
 */
export function storeLabel(storeId: string): string {
  return storeById(storeId)?.shortName ?? storeId
}

/**
 * The store scope, in business words, for any set of selected identifiers.
 *
 * Empty means the whole group, which is what an absent `store` parameter means in
 * the URL grammar. A selection covering every store in the dimension is the whole
 * group too: `?store=GSA-001,GSA-002,GSA-003` and no parameter at all describe the
 * same figures, so they get the same sentence.
 *
 * Two or more stores are joined with commas rather than summarized as a count,
 * because "2 stores" is a scope a reader cannot check a figure against.
 */
export function storeScopeLabel(storeIds: readonly string[]): string {
  const total = dashboardStores.length
  if (storeIds.length === 0 || storeIds.length >= total) return allStoresLabel(total)
  return storeIds.map(storeLabel).join(', ')
}
