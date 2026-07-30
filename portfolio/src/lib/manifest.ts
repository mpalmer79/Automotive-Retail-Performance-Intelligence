/**
 * The typed accessor for the generated project manifest.
 *
 * Every engineering count and every implementation status on the website comes
 * through this module. Importing the JSON directly from a component is a lint
 * error by convention and a test failure in practice
 * (`tests/unit/content-integrity.test.ts`), because the point of the manifest is
 * that there is exactly one path from evidence to pixel.
 */
import manifestJson from '@/generated/project-manifest.json'
import type {
  EngineValidation,
  Gate,
  ProjectManifest,
  StatusLevel,
} from '@/types/manifest'

export const manifest = manifestJson as unknown as ProjectManifest

export const counts = manifest.counts
export const semanticModel = manifest.semanticModel
export const engines = manifest.engines
export const lifecyclePhases = manifest.lifecyclePhases
export const increments = manifest.increments
export const gates = manifest.gates
export const evidence = manifest.evidence
export const caseStudy = manifest.caseStudy
export const dataset = manifest.dataset
export const project = manifest.project

/** A gate by its identifier. Throws rather than returning undefined, because a
 *  missing gate is a build-time error, not a run-time branch. */
export function gate(id: 'gate-1' | 'gate-2'): Gate {
  const found = gates.find((g) => g.id === id)
  if (!found) throw new Error(`Manifest has no gate "${id}".`)
  return found
}

export function engine(id: EngineValidation['id']): EngineValidation {
  const found = engines.find((e) => e.id === id)
  if (!found) throw new Error(`Manifest has no engine "${id}".`)
  return found
}

/** True when at least one ADR-0008 path has recorded a current PASSED result. */
export const realEngineValidated = semanticModel.realEngineStatus === 'complete'

/** True when the analytical case study may be published. */
export const caseStudyUnlocked = caseStudy.unlocked

/* -------------------------------------------------------------------------- */
/* Status vocabulary                                                           */
/* -------------------------------------------------------------------------- */

export interface StatusPresentation {
  /** The label the visitor reads. Never abbreviated to a colour. */
  readonly label: string
  /** Lucide icon name, resolved by <StatusBadge>. */
  readonly icon: 'check' | 'progress' | 'clock' | 'lock' | 'pause' | 'circle' | 'alert'
  /** Token group used for the badge's foreground and wash. */
  readonly tone: 'verified' | 'accent' | 'pending' | 'blocked' | 'deferred' | 'failed'
}

/**
 * The one place a status becomes a colour and a word. `pending-external` reads
 * as "Pending external validation", never as "In review" or "Almost there",
 * because the whole point is that this project has not had a Microsoft engine
 * look at its semantic model.
 */
export const STATUS_PRESENTATION: Record<StatusLevel, StatusPresentation> = {
  complete: { label: 'Complete', icon: 'check', tone: 'verified' },
  'in-progress': { label: 'In progress', icon: 'progress', tone: 'accent' },
  'pending-external': {
    label: 'Pending external validation',
    icon: 'clock',
    tone: 'pending',
  },
  blocked: { label: 'Blocked', icon: 'lock', tone: 'blocked' },
  deferred: { label: 'Deferred', icon: 'pause', tone: 'deferred' },
  'not-started': { label: 'Not started', icon: 'circle', tone: 'deferred' },
}

export function statusPresentation(status: StatusLevel): StatusPresentation {
  return STATUS_PRESENTATION[status]
}
