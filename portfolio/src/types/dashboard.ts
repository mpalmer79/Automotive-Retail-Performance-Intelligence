/**
 * The shape of the governed dashboard export and of the artefacts derived from it.
 *
 * WHERE THESE TYPES COME FROM, AND WHAT THEY MAY CLAIM
 * ---------------------------------------------------
 * The root export under `data/dashboard/` is produced by
 * `scripts/export_dashboard_dataset.py` from PostgreSQL `reporting` views, as
 * `arpi_reporter` (ADR-0013, delivery increment `DASH.1`). Its manifest carries the
 * full field-level contract: every dataset's grain, business key, date basis, column
 * list, types, nullability, privacy class and display precision.
 *
 * So this file deliberately does NOT restate that column list. A hand-copied second
 * copy of a seventeen-dataset contract would drift on its first edit, and the drift
 * would be invisible. What this file declares instead is:
 *
 *   1. The manifest's own envelope, which is small, stable, and the thing that has
 *      to be validated before anything inside it can be trusted.
 *   2. A pinned registry of dataset identities - name, grain, business key, date
 *      basis - so a manifest cannot silently rename, drop, or redefine a dataset and
 *      still validate.
 *   3. Row types as records of checked primitives, because the per-column contract
 *      lives in the manifest and is enforced against it at generation time by
 *      `scripts/generate-dashboard-data.ts`.
 *
 * No `any` appears anywhere in this file, and nothing in it asserts a type onto
 * external JSON: parsing goes through the runtime validators in the generator, which
 * narrow `unknown` step by step and fail with the dataset and column named.
 *
 * WHAT A CURRENCY VALUE IS
 * -----------------------
 * A string. `"−2529.18"` is a two-place exact decimal with its sign preserved, and it
 * is a string precisely so that no JavaScript number ever touches a gross figure. A
 * ratio is also a string, exact and unrounded at whatever scale the reporting view
 * produced, carrying `displayPrecision` so a future component can round for display
 * without the value having been rounded on the way here. An order statistic - a
 * median or a percentile - is a `number`, because PostgreSQL computed it as a
 * double and claiming decimal precision it never had would be a lie about the data.
 *
 * NOTHING IN `src/` MAY DO ARITHMETIC ON THESE VALUES IN THIS INCREMENT. `DASH.1`
 * ships the data lane and its guards; the components that display it arrive with
 * `DASH.2` and later, together with the exact-decimal display helpers they need.
 */

/* -------------------------------------------------------------------------- */
/* Primitives                                                                  */
/* -------------------------------------------------------------------------- */

/** An exact decimal carried as a string. Never parsed with `Number`. */
export type ExactDecimalString = string

/** An ISO `YYYY-MM-DD` calendar date. */
export type IsoDateString = string

/** An ISO-8601 UTC instant. Only the manifest carries one. */
export type IsoInstantString = string

/** A lowercase 64-character SHA-256 digest. */
export type Sha256 = string

/** Every value an exported cell may hold. */
export type DashboardCell = string | number | boolean | null

/** One exported row: the manifest declares its keys, their order and their types. */
export type DashboardRow = Readonly<Record<string, DashboardCell>>

/**
 * How a value crosses the JSON boundary, as the manifest declares it.
 *
 * A closed union rather than `string`, so an unknown type in a manifest is a
 * validation failure instead of an unchecked passthrough.
 */
export type DashboardColumnType =
  'currency' | 'exact' | 'double' | 'integer' | 'date' | 'string' | 'boolean'

/** The only privacy classification eligible for public export. */
export type DashboardPrivacyClass = 'non-personal'

/** The manifest schema this consumer understands. An unknown major version is refused. */
export const DASHBOARD_EXPORT_SCHEMA = 'arpi.dashboard_export/1' as const

/** The contract version this consumer understands. */
export const DASHBOARD_CONTRACT_VERSION = 1 as const

/** The client-safe manifest's own schema. */
export const DASHBOARD_CLIENT_SCHEMA = 'arpi.dashboard_client/1' as const

/* -------------------------------------------------------------------------- */
/* The pinned dataset registry                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Every dataset the console's data lane carries, and its identity.
 *
 * THIS IS THE ONE THING THE MANIFEST IS NOT ALLOWED TO TELL US. Everything else about
 * a dataset is read from the manifest and enforced against the files it hashes; but if
 * the dataset registry itself came from the manifest, a manifest that dropped a
 * dataset would validate cleanly and the console would render a smaller world without
 * anyone noticing. So the names, grains, keys and date bases are pinned here and
 * checked against the manifest in both directions.
 *
 * `chunked` marks the datasets the generator partitions by store and month. It is set
 * for the four whose grain includes a date and whose committed size makes a single
 * payload wasteful for a page that only ever wants one period.
 */
export const DASHBOARD_DATASETS = [
  {
    name: 'stores',
    businessKey: ['dealership_id'],
    dateBasis: null,
    chunked: false,
  },
  {
    name: 'calendar',
    businessKey: ['calendar_date'],
    dateBasis: 'calendar date',
    chunked: false,
  },
  {
    name: 'lead-sources',
    businessKey: ['lead_source_code'],
    dateBasis: null,
    chunked: false,
  },
  {
    name: 'campaigns',
    businessKey: ['campaign_code'],
    dateBasis: null,
    chunked: false,
  },
  {
    name: 'sales-summary',
    businessKey: ['dealership_id', 'sale_date'],
    dateBasis: 'sale date',
    chunked: false,
  },
  {
    name: 'gross-summary',
    businessKey: ['dealership_id', 'sale_date'],
    dateBasis: 'sale date',
    chunked: false,
  },
  {
    name: 'inventory-health',
    businessKey: ['dealership_id', 'snapshot_date', 'condition_group'],
    dateBasis: 'snapshot date',
    chunked: true,
  },
  {
    name: 'inventory-aging',
    businessKey: ['dealership_id', 'snapshot_date', 'condition_group', 'age_bucket'],
    dateBasis: 'snapshot date',
    chunked: true,
  },
  {
    name: 'days-to-sale',
    businessKey: ['dealership_id', 'sale_month_start_date', 'condition_group'],
    dateBasis: 'sale date',
    chunked: false,
  },
  {
    name: 'inventory-turn',
    businessKey: ['dealership_id', 'month_start_date', 'condition_group'],
    dateBasis: 'snapshot date',
    chunked: false,
  },
  {
    name: 'days-supply',
    businessKey: ['dealership_id', 'as_of_date', 'condition_group'],
    dateBasis: 'as-of date',
    chunked: true,
  },
  {
    name: 'lead-funnel',
    businessKey: [
      'dealership_id',
      'lead_source_code',
      'campaign_code',
      'lead_created_date',
    ],
    dateBasis: 'lead creation date',
    chunked: true,
  },
  {
    name: 'appointment-funnel',
    businessKey: ['dealership_id', 'appointment_date'],
    dateBasis: 'appointment date',
    chunked: false,
  },
  {
    name: 'lead-response',
    businessKey: ['dealership_id', 'lead_source_code', 'lead_created_date'],
    dateBasis: 'lead creation date',
    chunked: true,
  },
  {
    name: 'marketing-performance',
    businessKey: [
      'dealership_id',
      'month_start_date',
      'lead_source_code',
      'campaign_code',
    ],
    dateBasis: 'spend month',
    chunked: false,
  },
  /*
   * `DASH.10`. Three datasets for one route, and all three are chunked.
   *
   * They are partitioned for the same reason `lead-funnel` and `lead-response` are: the
   * grain includes a date, the whole-file payload is measured in megabytes, and a page only
   * ever wants one period. Committed root sizes are 904 kB, 1.31 MB and 1.54 MB — the
   * smallest of the three is already three and a half times `appointment-funnel`, which is
   * the largest thing this lane leaves unchunked.
   *
   * `lead-response-distribution` carries `first_response_seconds` in its business key, and
   * NULL is a key component there exactly as `campaign_code` is on `lead-funnel`: the
   * never-responded bin is a real row identified by the absence of a response, not a
   * missing value. Uniqueness is asserted over the five-column tuple with that null
   * included, which is what stops the ignored population being silently merged into a
   * response value.
   */
  {
    name: 'appointment-source-funnel',
    businessKey: [
      'dealership_id',
      'lead_source_code',
      'campaign_code',
      'appointment_date',
    ],
    dateBasis: 'appointment date',
    chunked: true,
  },
  {
    name: 'lead-stage-loss',
    businessKey: [
      'dealership_id',
      'lead_source_code',
      'campaign_code',
      'lead_created_date',
    ],
    dateBasis: 'lead creation date',
    chunked: true,
  },
  {
    name: 'lead-response-distribution',
    businessKey: [
      'dealership_id',
      'lead_source_code',
      'campaign_code',
      'lead_created_date',
      'first_response_seconds',
    ],
    dateBasis: 'lead creation date',
    chunked: true,
  },
  {
    name: 'sales-gross-trend',
    businessKey: ['dealership_id', 'sale_date'],
    dateBasis: 'sale date',
    chunked: false,
  },
  {
    name: 'gross-change-bridge',
    businessKey: ['dealership_id', 'month_start_date', 'component_code'],
    dateBasis: 'sale date, aggregated to calendar month',
    chunked: false,
  },
  {
    // The operating plan beside the actual (`DASH.5`). Deliberately NOT chunked: three
    // stores x six months x four scope-metric combinations is 72 rows, two orders of
    // magnitude inside the single-file ceiling, and partitioning it would add eighteen
    // files and a chunk table to save nothing.
    //
    // The business key carries the target SCOPE as well as the store, month and metric,
    // because a department row and a store row exist for the same month and are
    // different plans: the department rows are refinements of the store plan and are
    // never added to it.
    name: 'target-attainment',
    businessKey: [
      'dealership_id',
      'target_month',
      'target_scope_type',
      'target_scope_id',
      'target_kpi_id',
    ],
    dateBasis: 'target month for the plan; sale date for every actual',
    chunked: false,
  },
  {
    // The first chunked dataset whose business key is not a date. It partitions by
    // store and SALE month, which is `sale_date` - the first date column the dataset
    // declares, and the one the transformer partitions on. Delivery month is a
    // different question and is never the partition key.
    name: 'deal-explorer',
    businessKey: ['sale_id'],
    dateBasis: 'sale date',
    chunked: true,
  },
  {
    // The second deal-grain dataset, and the presentation-complete one. It carries
    // the cost components `deal-explorer` deliberately omits, and is read only by
    // the Deal Jacket route: an index must not ship the whole population's cost
    // structure, and a jacket must show the arithmetic behind its front gross.
    name: 'deal-jacket',
    businessKey: ['sale_id'],
    dateBasis: 'sale date',
    chunked: true,
  },
  {
    // The F&I lane (`DASH.7`). Four datasets, and the thing that matters most about them
    // is that they DO NOT SHARE A GRAIN. `fi-summary` carries finance reserve and retail
    // units and no category; `fi-product-penetration` carries the category and neither of
    // those. That separation is `DASH.6`'s and it is what stops a category join from
    // multiplying a deal-level measure across ten rows. The transformer preserves it.
    name: 'fi-summary',
    businessKey: ['dealership_id', 'sale_date', 'finance_manager_code'],
    dateBasis: 'sale date for every production measure; as-of for the retained ones',
    chunked: false,
  },
  {
    // CHUNKED on the measurement: 3,012 rows and 2.17 MB in the root export, ten category
    // rows per store-day-manager group, second-largest dataset in the lane. `fi-summary`
    // at 354 rows and `fi-adjustment-summary` at 57 stay in one file each for the same
    // reason inverted.
    name: 'fi-product-penetration',
    businessKey: [
      'dealership_id',
      'sale_date',
      'finance_manager_code',
      'product_category',
    ],
    dateBasis:
      'sale date for the population and the production; as-of for the retained gross',
    chunked: true,
  },
  {
    // THE ONLY DATASET ON THE ADJUSTMENT-DATE BASIS, which is why it is a separate dataset
    // rather than more columns on `fi-summary`: an August chargeback on a June contract
    // belongs to August, and two date bases inside one grain would put two populations
    // behind one row with nothing failing.
    name: 'fi-adjustment-summary',
    businessKey: [
      'dealership_id',
      'adjustment_date',
      'finance_manager_code',
      'product_category',
      'adjustment_type',
    ],
    dateBasis:
      "adjustment date -- the event's OWN business date, never the parent sale's",
    // NOT chunked, and for two reasons. 57 rows and 33 kB is two orders of magnitude
    // inside the ceiling; and its first date column is `adjustment_date`, so partitioning
    // it would key partitions by the ADJUSTMENT month while every other partition in the
    // console is keyed by the SALE month. Two partition semantics under one naming scheme
    // is the kind of thing that reads as a bug months later.
    chunked: false,
  },
  {
    // The third deal-grain dataset: the contract itemization behind one deal's back gross.
    // Chunked by store and SALE month -- the same partition key `deal-jacket` uses -- so a
    // jacket page opens exactly one product partition, and it is the one it already opened
    // for the deal row.
    name: 'deal-product-detail',
    businessKey: ['product_sale_id'],
    dateBasis: 'sale date for the contract; as-of for its retained gross',
    chunked: true,
  },
  {
    // DASH.9. The console's unit-grain inventory surface. Month-end grain plus the latest
    // snapshot date, NOT daily: at daily grain this exported at 31.3 MB against a 3 MB
    // per-file ceiling, and it would have lined up with the month-end accounting schedule
    // on roughly one day in thirty. Chunked by store and snapshot month, so the inventory
    // page opens one partition per store-month.
    name: 'inventory-units',
    businessKey: ['dealership_id', 'snapshot_date', 'vehicle_id'],
    dateBasis: 'snapshot date',
    chunked: true,
  },
  {
    // DASH.9. The accounting position of one unit at one month end. Shares its grain with
    // `inventory-units` exactly -- 1,501 rows each, 1,501 matched, zero orphans -- which is
    // what lets a unit detail panel show its accounting position without a fuzzy join.
    name: 'inventory-accounting',
    businessKey: ['dealership_id', 'accounting_date', 'vehicle_id'],
    dateBasis: 'accounting date',
    chunked: true,
  },
  {
    // DASH.9. The GL-versus-subledger comparison. 43 rows; chunking it would be symmetry
    // for its own sake, and the accounting page reads the whole set to total a signed
    // variance across stores anyway.
    name: 'inventory-gl-reconciliation',
    businessKey: ['dealership_id', 'comparison_date', 'gl_account_number'],
    dateBasis: 'comparison date',
    chunked: false,
  },
  {
    // DASH.9. Four rows. Its date column is `exception_date`, which is the exception's own
    // business date and not a sale month, so partitioning it would key partitions by a
    // third date semantic -- the same reason `fi-adjustment-summary` is unchunked.
    name: 'accounting-exceptions',
    businessKey: ['exception_id'],
    dateBasis: 'exception date',
    chunked: false,
  },
  {
    // DASH.11. The employee roster, current version only: 30 rows and 5 KB. Chunking a
    // dimension every route reads whole would add partitions with no read to save.
    name: 'employees',
    businessKey: ['employee_code'],
    dateBasis: null,
    chunked: false,
  },
  {
    // DASH.11. CHUNKED ON THE MEASUREMENT: 1,036 rows and 614 KB in the root export, which
    // re-encodes columnar to 159,201 B -- 62% of the 256 KB whole-file ceiling, which is
    // inside it but not comfortably so, and the employee lane grows with deliveries. Store x
    // month partitions the page's two commonest filters and takes the largest partition to
    // 11,503 B. `employee-finance` at 43,910 B and `employee-appointments` at 48,101 B are
    // one file each for the inverse reason.
    name: 'employee-sales',
    businessKey: ['dealership_id', 'activity_date', 'role_family', 'employee_code'],
    dateBasis: 'sale date',
    chunked: true,
  },
  {
    // DASH.11. 354 rows and 165 KB, so one file, for the same reason `fi-summary` is one
    // file at 267 KB: the partitions would each be a few kilobytes and the page reads the
    // set to total a structure mix across stores anyway.
    name: 'employee-finance',
    businessKey: ['dealership_id', 'activity_date', 'role_family', 'employee_code'],
    dateBasis: 'sale date',
    chunked: false,
  },
  {
    // DASH.11. 539 rows and 218 KB, one file on the same grounds. Its date column carries
    // TWO bases -- appointment scheduled and appointment show -- so a month partition would
    // key partitions by a date whose meaning changes per column, which is exactly the
    // reason `fi-adjustment-summary` is unchunked.
    name: 'employee-appointments',
    businessKey: ['dealership_id', 'activity_date', 'role_family', 'employee_code'],
    dateBasis: 'appointment scheduled date and appointment show date',
    chunked: false,
  },
  {
    // DASH.11. CHUNKED: 5,963 rows and 2.26 MB, the largest dataset in the employee lane and
    // the second largest in the export. One row per response bin, so the set grows with
    // leads rather than with employees.
    name: 'employee-lead-source',
    businessKey: [
      'dealership_id',
      'lead_created_date',
      'role_family',
      'employee_code',
      'lead_source_code',
      'first_response_seconds',
    ],
    dateBasis: 'lead creation date',
    chunked: true,
  },
  {
    name: 'reconciliation-status',
    businessKey: ['reconciliation_id'],
    dateBasis: null,
    chunked: false,
  },
  {
    name: 'pipeline-run',
    businessKey: ['run_uuid'],
    dateBasis: null,
    chunked: false,
  },
] as const satisfies readonly DatasetIdentity[]

/** One pinned dataset identity. */
export interface DatasetIdentity {
  readonly name: string
  readonly businessKey: readonly string[]
  readonly dateBasis: string | null
  readonly chunked: boolean
}

/** Every dataset name, as a literal union derived from the registry. */
export type DashboardDatasetName = (typeof DASHBOARD_DATASETS)[number]['name']

/* -------------------------------------------------------------------------- */
/* The root manifest                                                           */
/* -------------------------------------------------------------------------- */

/** One column's contract, exactly as the root manifest declares it. */
export interface DashboardColumnContract {
  readonly name: string
  readonly type: DashboardColumnType
  readonly nullable: boolean
  readonly class: DashboardPrivacyClass
  readonly unit: string | null
  readonly display_precision: number | null
  readonly enumeration: readonly string[] | null
  readonly source_column: string
}

/** One dataset's entry in the root manifest. */
export interface DashboardDatasetManifest {
  readonly name: string
  readonly source_view: string
  readonly join_views: readonly string[]
  readonly grain: string
  readonly business_key: readonly string[]
  readonly date_basis: string | null
  readonly sort_keys: readonly string[]
  readonly chunked: boolean
  readonly kpi_ids: readonly string[]
  readonly columns: readonly DashboardColumnContract[]
  readonly notes: string
  readonly query_sha256: Sha256
  readonly row_count: number
  readonly file: string
  readonly file_sha256: Sha256
  readonly file_bytes: number
}

/**
 * A group-level reconciliation total.
 *
 * Two shapes, and the difference is deliberate. A plain total carries `column` and
 * `total`. A ratio carries `numeratorColumn`/`denominatorColumn` and the two exact
 * sums, and NO quotient: the reporting layer publishes numerator and denominator as
 * separate additive columns and leaves division to the consumer, which is what makes
 * an average of store averages impossible to form from this block.
 */
export type DashboardReconciliationTotal =
  | {
      readonly dataset: string
      readonly kpi_id: string | null
      readonly unit: string | null
      readonly display_precision: number | null
      /**
       * The declared row subset the total covers, or `null` for the whole dataset.
       *
       * `target-attainment` carries unit targets and currency targets in one column, and
       * store plans beside department refinements of them, so a total over the whole
       * dataset would add units to dollars and count the same gross twice. The subset is
       * part of the exporter's contract declaration, so it moves the contract
       * fingerprint when it changes.
       */
      readonly subset: Readonly<Record<string, string>> | null
      readonly column: string
      readonly total: ExactDecimalString
    }
  | {
      readonly dataset: string
      readonly kpi_id: string | null
      readonly unit: string | null
      readonly display_precision: number | null
      readonly subset: Readonly<Record<string, string>> | null
      readonly numerator_column: string
      readonly denominator_column: string
      readonly numerator: ExactDecimalString
      readonly denominator: ExactDecimalString
    }

/** The root export manifest, `data/dashboard/manifest.json`. */
export interface DashboardExportManifest {
  readonly schema: typeof DASHBOARD_EXPORT_SCHEMA
  readonly contract_version: number
  readonly contract_sha256: Sha256
  readonly dataset_version: number
  readonly generated_at: IsoInstantString
  readonly as_of_date: IsoDateString
  readonly profile: string
  readonly random_seed: number
  readonly source_commit: string
  readonly exporter_version: string
  readonly query_normalisation: string
  readonly reporter_role: string
  readonly synthetic_data: true
  readonly fictional_dealer_group: true
  readonly pipeline_run: {
    readonly run_uuid: string
    readonly logical_run_key: string | null
    readonly status: string
  }
  readonly source_views: readonly string[]
  readonly datasets: readonly DashboardDatasetManifest[]
  readonly reconciliation: {
    readonly status: string
    readonly method: string
    readonly totals: Readonly<Record<string, DashboardReconciliationTotal>>
  }
  readonly privacy_scan: {
    readonly status: string
    readonly prohibited_hits: number
    readonly columns_scanned: number
    readonly primary_control: string
    readonly secondary_control: string
  }
  readonly validation: {
    readonly critical_failures: number
    readonly warnings: number
    readonly checks_evaluated: number
    readonly reconciliations_evaluated: number
    readonly reconciliations_failed: number
  }
  readonly sizes: {
    readonly dataset_bytes_total: number
    readonly largest_dataset: {
      readonly name: string
      readonly bytes: number
      readonly rows: number
    }
    readonly limits: Readonly<Record<string, number>>
  }
  readonly stale: false
  readonly limitations: readonly string[]
}

/* -------------------------------------------------------------------------- */
/* The generated, client-safe artefacts                                        */
/* -------------------------------------------------------------------------- */

/**
 * The client-safe manifest, `portfolio/src/generated/dashboard/manifest.json`.
 *
 * This is what a trust panel renders. It carries dataset identity, provenance and
 * status - and deliberately not the root manifest's per-column contract, which is
 * build-time information a browser has no use for and which would be pure bundle
 * weight if a client component ever imported it.
 *
 * `powerBi` is absent on purpose. Power BI validation state comes from
 * `powerbi/validation/*.json` and is merged by the trust panel that `DASH.2` owns;
 * putting a Power BI field here would create a second place a "validated" claim
 * could be written, and both ADR-0008 paths are still pending.
 */
export interface DashboardClientManifest {
  readonly schema: typeof DASHBOARD_CLIENT_SCHEMA
  readonly datasetVersion: number
  readonly contractVersion: number
  readonly contractSha256: Sha256
  readonly generatedAt: IsoInstantString
  readonly asOfDate: IsoDateString
  readonly profile: string
  readonly randomSeed: number
  readonly sourceCommit: string
  readonly exporterVersion: string
  readonly syntheticData: true
  readonly fictionalDealerGroup: true
  readonly pipelineRunUuid: string
  readonly pipelineRunStatus: string
  readonly sourceViews: readonly string[]
  readonly reconciliationStatus: string
  readonly reconciliationMethod: string
  readonly reconciliationTotals: Readonly<Record<string, DashboardReconciliationTotal>>
  readonly privacyScanStatus: string
  readonly validationCriticalFailures: number
  readonly validationWarnings: number
  readonly reconciliationsEvaluated: number
  readonly reconciliationsFailed: number
  readonly stale: false
  readonly limitations: readonly string[]
  readonly datasets: readonly DashboardClientDataset[]
  readonly sizes: DashboardSizeReport
  /**
   * `DASH.12`'s management-action queue.
   *
   * Held apart from `datasets` for the same reason the root manifest holds it apart: every
   * entry in that list is read from an allowlisted reporting view, and the queue is DERIVED
   * from the list itself by evaluating the rule file against it.
   */
  readonly actions: DashboardActionManifest
}

/** One dataset as the client-safe manifest describes it. */
export interface DashboardClientDataset {
  readonly name: DashboardDatasetName
  readonly grain: string
  readonly businessKey: readonly string[]
  readonly dateBasis: string | null
  readonly kpiIds: readonly string[]
  readonly rowCount: number
  readonly columns: readonly DashboardClientColumn[]
  /** Present when the dataset is partitioned; `null` when it is one file. */
  readonly chunks: readonly DashboardChunkPointer[] | null
}

/**
 * A column as the client-safe manifest describes it.
 *
 * Enough for a component to label a value, choose a display precision and decide
 * whether "Not applicable" is a legitimate rendering. Not the SQL lineage: that stays
 * in the root manifest, where a reviewer wants it and a browser does not.
 */
export interface DashboardClientColumn {
  readonly name: string
  readonly type: DashboardColumnType
  readonly nullable: boolean
  readonly unit: string | null
  readonly displayPrecision: number | null
  readonly enumeration: readonly string[] | null
}

/** Where one partition of a chunked dataset lives, and what it holds. */
export interface DashboardChunkPointer {
  /** Store business code, e.g. `GSA-001`. */
  readonly dealershipId: string
  /** Calendar month, `YYYY-MM`. */
  readonly month: string
  /** Path relative to `portfolio/src/generated/dashboard/`. */
  readonly file: string
  readonly rowCount: number
  readonly bytes: number
}

/** The measured size of everything the generator wrote. */
export interface DashboardSizeReport {
  readonly totalBytes: number
  readonly fileCount: number
  readonly largestFile: { readonly file: string; readonly bytes: number }
  readonly rootExportBytes: number
}

/**
 * A whole dataset file as the generator writes it.
 *
 * COLUMNAR, AND DELIBERATELY SO. `rows` holds one array of values per row, in `columns`
 * order, rather than one object per row.
 *
 * The reviewable artefact is `data/dashboard/`, where every row IS an object with its keys
 * spelled out, because that is the file a human reads in a diff to see which measure
 * moved. This file is the build product: nothing but `generate-dashboard-data.ts` writes
 * it and nothing but a server component reads it. Repeating seventeen column names on
 * every one of sixteen thousand rows costs roughly four bytes of key for every byte of
 * value, and paying that twice - once in the export, once here - would have added about
 * 7 MB to the repository to say the same thing again in the same words.
 *
 * Every value is preserved exactly: this is a re-encoding, not a transformation. `columns`
 * is the key, and `toRows()` in the consumer rehydrates objects when a caller wants them.
 */
export interface DashboardDatasetFile {
  readonly dataset: DashboardDatasetName
  readonly rowCount: number
  readonly columns: readonly string[]
  readonly rows: readonly (readonly DashboardCell[])[]
}

/* -------------------------------------------------------------------------- */
/* DASH.12 — the management action queue                                       */
/* -------------------------------------------------------------------------- */

/** The action file's schema identifier. */
export const DASHBOARD_ACTIONS_SCHEMA = 'arpi.management_actions/1' as const

/**
 * The three severity levels, MOST SEVERE FIRST.
 *
 * Severity is the rule's own classification of a matched condition. It is not a
 * probability, a confidence, a financial materiality score or a priority ranking, and
 * nothing in the console may present it as one.
 */
export const ACTION_SEVERITIES = ['high', 'medium', 'low'] as const
export type ActionSeverity = (typeof ACTION_SEVERITIES)[number]

/** The stable domain vocabulary, in console order. There is no `other`. */
export const ACTION_DOMAINS = [
  'inventory',
  'sales-gross',
  'fi',
  'leads',
  'accounting',
] as const
export type ActionDomain = (typeof ACTION_DOMAINS)[number]

/**
 * The governed role vocabulary.
 *
 * A REVIEW role: the role best placed to look at the evidence. Never an assignment, a
 * responsibility, an accountability or a statement of fault.
 */
export const ACTION_OWNER_ROLES = [
  'Dealer principal',
  'General manager',
  'General sales manager',
  'Used-car manager',
  'F&I manager',
  'BDC manager',
  'Controller',
] as const
export type ActionOwnerRole = (typeof ACTION_OWNER_ROLES)[number]

/** One evidence value, copied verbatim from the exported column that produced it. */
export interface ActionEvidence {
  readonly name: string
  /** Exactly what the export carried, including `null`, which never becomes zero. */
  readonly value: DashboardCell
  readonly type: DashboardColumnType
  readonly unit: string | null
  readonly displayPrecision: number | null
}

/**
 * One threshold that decided an action, and where its value is governed.
 *
 * `governed` means the number was read from the row or from an existing project authority,
 * so the console shows what the export carried. `project-default-review-threshold` means
 * the rule file owns it — and it is a project default for a fictional dealer group, never
 * an industry benchmark, an OEM standard or a compliance requirement.
 */
export interface ActionThreshold {
  readonly name: string
  readonly label: string
  readonly value: string | null
  readonly units: string
  readonly source: 'governed' | 'project-default-review-threshold'
  readonly authority: string
}

/** One review prompt. */
export interface ManagementAction {
  readonly actionId: string
  readonly ruleId: string
  readonly domain: ActionDomain
  readonly asOfDate: IsoDateString
  readonly store: string | null
  readonly entityType: string
  readonly entityId: string
  readonly severity: ActionSeverity
  readonly title: string
  readonly ownerRole: ActionOwnerRole
  readonly recommendedReview: string
  readonly limitations: string
  readonly dateBasis: string | null
  readonly observedDate: IsoDateString | null
  readonly drillThrough: string
  readonly evidence: readonly ActionEvidence[]
  readonly thresholdsUsed: readonly ActionThreshold[]
}

/** The change-driver DISPLAY policy. The bridge's arithmetic is owned by SQL. */
export interface ActionChangeDriverPolicy {
  readonly authority: string
  readonly dataset: DashboardDatasetName
  readonly decompositionOrder: readonly string[]
  readonly materiality: {
    readonly value: ExactDecimalString
    readonly units: string
    readonly label: string
    readonly rationale: string
  }
}

/** What produced the queue, so it can always be traced to one ruleset. */
export interface ActionRulesetIdentity {
  readonly schema: string
  readonly rulesetVersion: number
  readonly file: string
  readonly fileSha256: Sha256
  readonly expiry: 'dataset'
  readonly ruleCount: number
  readonly enabledRuleIds: readonly string[]
  readonly disabledRuleIds: readonly string[]
}

/** Presentation counts derived from the queue itself. Not KPIs. */
export interface ActionQueueCounts {
  readonly bySeverity: Readonly<Record<string, number>>
  readonly byDomain: Readonly<Record<string, number>>
  readonly byStore: Readonly<Record<string, number>>
  readonly byOwnerRole: Readonly<Record<string, number>>
  readonly byRule: Readonly<Record<string, number>>
}

/** Everything the client manifest carries about the queue. */
export interface DashboardActionManifest {
  readonly schema: typeof DASHBOARD_ACTIONS_SCHEMA
  readonly rowCount: number
  readonly asOfDate: IsoDateString
  readonly fileSha256: Sha256
  readonly rootExportBytes: number
  readonly ruleset: ActionRulesetIdentity
  readonly sourceDatasets: readonly DashboardDatasetName[]
  readonly counts: ActionQueueCounts
  readonly changeDrivers: ActionChangeDriverPolicy
  readonly boundaries: readonly string[]
}

/** The generated action file. */
export interface DashboardActionFile {
  readonly schema: typeof DASHBOARD_ACTIONS_SCHEMA
  readonly rowCount: number
  readonly actions: readonly ManagementAction[]
}
