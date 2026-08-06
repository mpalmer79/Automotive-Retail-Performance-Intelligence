/**
 * Icons for the six analytical domains and the two store types.
 *
 * WHY THE MAP IS HERE AND NOT IN THE CONTENT FILES
 * ------------------------------------------------
 * `lib/content.ts` and the generated dealership artefacts are DATA - the domain
 * definitions come from the KPI catalogue and the stores come from the sanitized
 * workbooks. Putting a React component reference in either would make a
 * presentation decision part of a content contract that a generator writes, and
 * the generator would then have to know about `lucide-react`.
 *
 * So the mapping lives in the component layer, keyed by the ids the content
 * already declares, and `tests/unit/components.test.tsx` asserts every declared
 * id has one - a domain added to the catalogue without an icon fails the suite
 * rather than rendering a gap.
 *
 * THEY SUPPORT LABELS, THEY DO NOT REPLACE THEM
 * ---------------------------------------------
 * Every one of these is rendered beside its own visible text, never instead of
 * it. An icon-only domain rail would be six glyphs a reader has to decode, and
 * "gross" has no icon anybody recognises. They are therefore decorative in the
 * strict accessibility sense - the adjacent text carries the meaning - and every
 * one carries `aria-hidden`, so a screen-reader user hears the label once rather
 * than hearing an image role in front of it.
 *
 * ONE ICON PACKAGE. `lucide-react` is already a dependency and every icon on
 * this site comes from it. A second package for eight glyphs would be a second
 * stroke weight, a second grid and a second set of bytes.
 */
import {
  Banknote,
  Boxes,
  Building2,
  Car,
  Database,
  Filter,
  Layers,
  Megaphone,
  ShieldCheck,
  Store,
  type LucideIcon,
} from 'lucide-react'

import type { DomainId } from '@/lib/content'

/**
 * One icon per analytical domain.
 *
 * Chosen for what the domain measures rather than for what a stock icon set
 * calls "analytics": `Car` for retail units delivered, `Banknote` for gross,
 * `Boxes` for inventory on the ground, `Filter` for the lead funnel, `Megaphone`
 * for marketing spend and `ShieldCheck` for the data-quality domain that gates
 * the rest.
 */
export const DOMAIN_ICON: Record<DomainId, LucideIcon> = {
  sales: Car,
  gross: Banknote,
  inventory: Boxes,
  funnel: Filter,
  marketing: Megaphone,
  dataQuality: ShieldCheck,
}

/**
 * One icon per store type.
 *
 * `Building2` for a franchise rooftop operating under a manufacturer agreement,
 * `Store` for the independent that buys everything it sells. The distinction is
 * the whole argument of the store chapter, so it gets a visual carrier - beside
 * the words "Franchise" and "Independent", never instead of them.
 */
export const STORE_TYPE_ICON = {
  franchise: Building2,
  independent: Store,
} as const satisfies Record<string, LucideIcon>

/** The platform surfaces, where a route needs a consistent mark. */
export const SURFACE_ICON = {
  inventory: Boxes,
  architecture: Layers,
  dataModel: Database,
  kpiGovernance: ShieldCheck,
} as const satisfies Record<string, LucideIcon>
