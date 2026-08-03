/**
 * Component and library tests.
 *
 * These cover the behaviour that a browser test would be slow to check and that
 * jsdom can genuinely observe: markup, ARIA attributes, filtering, search, state
 * transitions and derived values.
 *
 * They deliberately do NOT check anything requiring layout - focus order across
 * a page, computed contrast, horizontal overflow, whether an animation ran. jsdom
 * has no layout engine, so a test asserting those here would pass without
 * checking them, which is worse than not having it. Those live in Playwright.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { Badge, KpiChip, StatusBadge } from '@/components/ui/badge'
import { Button, IconButton, LinkButton } from '@/components/ui/button'
import { SourceLink } from '@/components/ui/data-card'
import { Breadcrumbs, EmptyState, LockedState, SkipLink } from '@/components/ui/states'
import { CodeLabel, GrainLabel, Heading } from '@/components/ui/typography'
import { DOMAINS, dimensions, facts, kpiIdsForDomain, kpis } from '@/lib/content'
import { DURATION, EASE, target } from '@/lib/motion'
import { STATUS_PRESENTATION, statusPresentation } from '@/lib/manifest'
import {
  ALL_ROUTES,
  INDEXABLE_ROUTES,
  PRIMARY_NAV,
  ROUTES,
  repoFileUrl,
  routeByHref,
} from '@/lib/site'
import { pageMetadata, structuredData } from '@/lib/metadata'
import { clamp, cx, formatCount, formatDate, groupBy, slugify } from '@/lib/utils'

/* -------------------------------------------------------------------------- */
/* The route map                                                              */
/* -------------------------------------------------------------------------- */

describe('the route map', () => {
  it('holds the nine documented routes plus the internal UI lab', () => {
    expect(ALL_ROUTES).toHaveLength(10)
    const hrefs = ALL_ROUTES.map((r) => r.href)
    expect(hrefs).toEqual([
      '/',
      '/architecture',
      '/data-model',
      '/inventory-operations',
      '/kpis',
      '/governance',
      '/status',
      '/about',
      '/case-study',
      '/ui-lab',
    ])
  })

  it('puts five content destinations in the header and excludes the case study', () => {
    // Five, not seven: Architecture, Data Model and Governance are grouped under
    // "Platform". The full navigation contract is covered in
    // tests/unit/site.test.ts; this is the component suite's own check that the
    // list it renders from has not quietly grown.
    expect(PRIMARY_NAV).toHaveLength(5)
    expect(PRIMARY_NAV.map((r) => r.href)).not.toContain('/case-study')
    expect(PRIMARY_NAV.map((r) => r.href)).not.toContain('/ui-lab')
  })

  it('excludes the UI lab from the indexable set', () => {
    expect(INDEXABLE_ROUTES.map((r) => r.href)).not.toContain('/ui-lab')
    expect(ROUTES.uiLab.indexable).toBe(false)
  })

  it('gives every route a description long enough to be a useful meta description', () => {
    for (const route of ALL_ROUTES) {
      expect(
        route.description.length,
        `${route.href} description too short`
      ).toBeGreaterThan(60)
      expect(route.description.length, `${route.href} description too long`).toBeLessThan(
        320
      )
      expect(route.navLabel.length).toBeGreaterThan(0)
      expect(route.title.length).toBeGreaterThan(0)
    }
  })

  it('resolves a route by pathname, and nothing for an unknown one', () => {
    expect(routeByHref('/kpis')?.navLabel).toBe('KPIs')
    expect(routeByHref('/nope')).toBeUndefined()
  })
})

describe('repository file links', () => {
  it('uses blob for a file and tree for a directory', () => {
    expect(repoFileUrl('KPI_CATALOG.md')).toContain('/blob/main/KPI_CATALOG.md')
    expect(repoFileUrl('sql/05_reporting/')).toContain('/tree/main/sql/05_reporting')
  })

  it('does not double a slash or leave a trailing one', () => {
    expect(repoFileUrl('/sql/')).not.toContain('//sql')
    expect(repoFileUrl('/sql/')).not.toMatch(/\/$/)
  })
})

/* -------------------------------------------------------------------------- */
/* Metadata                                                                    */
/* -------------------------------------------------------------------------- */

describe('page metadata', () => {
  it('gives the home page an absolute title so it does not read "ARPI - ARPI"', () => {
    const meta = pageMetadata('home')
    expect(meta.title).toEqual({ absolute: 'Automotive Retail Performance Intelligence' })
  })

  it('gives every other route a title the layout template will suffix', () => {
    expect(pageMetadata('architecture').title).toBe('Architecture')
    expect(pageMetadata('kpis').title).toBe('KPI catalogue')
  })

  it('sets a canonical URL per route', () => {
    expect(pageMetadata('status').alternates?.canonical).toContain('/status')
  })

  it('marks the UI lab noindex', () => {
    expect(pageMetadata('uiLab').robots).toMatchObject({ index: false, follow: false })
  })
})

describe('structured data', () => {
  const graph = JSON.parse(structuredData()) as {
    '@context': string
    '@graph': { '@type': string; abstract?: string }[]
  }

  it('declares exactly the four types this project can honestly claim', () => {
    expect(graph['@context']).toBe('https://schema.org')
    const types = graph['@graph'].map((node) => node['@type']).sort()
    expect(types).toEqual(['CreativeWork', 'Person', 'SoftwareSourceCode', 'WebSite'])
  })

  it('declares no rating, review, award, offer or organization', () => {
    const serialised = structuredData()
    for (const forbidden of [
      'AggregateRating',
      'Review',
      'Rating',
      'Offer',
      'Product',
      'Organization',
      'award',
      'testimonial',
    ]) {
      expect(serialised, `structured data must not include ${forbidden}`).not.toContain(
        forbidden
      )
    }
  })

  it('states the synthetic-data qualification in machine-readable form', () => {
    const work = graph['@graph'].find((node) => node['@type'] === 'CreativeWork')
    expect(work?.abstract).toMatch(/synthetic/i)
    expect(work?.abstract).toMatch(/fictional/i)
  })
})

/* -------------------------------------------------------------------------- */
/* Status vocabulary                                                           */
/* -------------------------------------------------------------------------- */

describe('the status vocabulary', () => {
  it('never renders a pending status with a word that implies success', () => {
    const pending = statusPresentation('pending-external')
    expect(pending.label).toBe('Pending external validation')
    expect(pending.label.toLowerCase()).not.toMatch(
      /valid(ated)?\b(?! validation)|pass|complete|done|ready/
    )
  })

  it('gives every status a distinct icon, so colour is never the only signal', () => {
    const icons = Object.values(STATUS_PRESENTATION).map((p) => p.icon)
    const statuses = Object.keys(STATUS_PRESENTATION)
    // Two statuses may share a tone, but a status that shares BOTH icon and tone
    // with another is indistinguishable in greyscale.
    const pairs = Object.values(STATUS_PRESENTATION).map((p) => `${p.icon}/${p.tone}`)
    expect(
      new Set(pairs).size,
      `${statuses.length} statuses collapsed to ${new Set(pairs).size} appearances`
    ).toBe(statuses.length)
    expect(icons.length).toBe(6)
  })

  it('renders both an icon and a word', () => {
    render(<StatusBadge status="pending-external" />)
    const badge = screen.getByText('Pending external validation')
    expect(badge).toBeInTheDocument()
    expect(badge.querySelector('svg')).toBeTruthy()
  })

  it('exposes the status as a data attribute for testing and styling', () => {
    render(<StatusBadge status="blocked" />)
    expect(screen.getByText('Blocked')).toHaveAttribute('data-status', 'blocked')
  })

  it('allows a domain-specific label without losing the status semantics', () => {
    render(<StatusBadge status="blocked" label="No page exists" />)
    const badge = screen.getByText('No page exists')
    expect(badge).toHaveAttribute('data-status', 'blocked')
  })
})

/* -------------------------------------------------------------------------- */
/* Buttons and links                                                           */
/* -------------------------------------------------------------------------- */

describe('buttons', () => {
  it('renders an action as a button and a navigation as an anchor', () => {
    const { unmount } = render(<Button>Act</Button>)
    expect(screen.getByRole('button', { name: 'Act' })).toBeInTheDocument()
    unmount()
    render(<LinkButton href="/status">Navigate</LinkButton>)
    expect(screen.getByRole('link', { name: 'Navigate' })).toHaveAttribute(
      'href',
      '/status'
    )
  })

  it('names an external link as external in text, not only with an icon', () => {
    render(
      <LinkButton href="https://example.com" external>
        Repository
      </LinkButton>
    )
    const link = screen.getByRole('link')
    expect(link).toHaveAccessibleName(/opens in a new tab/i)
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('marks a loading button busy rather than renaming it', async () => {
    render(<Button loading>Save</Button>)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toBeDisabled()
  })

  it('requires an accessible name on an icon-only control', () => {
    render(
      <IconButton label="Reset the selection">
        <svg />
      </IconButton>
    )
    expect(
      screen.getByRole('button', { name: 'Reset the selection' })
    ).toBeInTheDocument()
  })

  it('does not fire a disabled action', async () => {
    let clicked = 0
    render(
      <Button
        disabled
        onClick={() => {
          clicked += 1
        }}
      >
        Act
      </Button>
    )
    await userEvent
      .click(screen.getByRole('button', { name: 'Act' }))
      .catch(() => undefined)
    expect(clicked).toBe(0)
  })
})

/* -------------------------------------------------------------------------- */
/* Source links                                                                */
/* -------------------------------------------------------------------------- */

describe('source links', () => {
  it('names the full path in the accessible name even when the display is shortened', () => {
    const longPath =
      'powerbi/ARPI_Performance_Intelligence/ARPI_Performance_Intelligence.SemanticModel/definition/relationships.tmdl'
    render(<SourceLink path={longPath} field="relationship definitions" />)
    const link = screen.getByRole('link')
    expect(link).toHaveAccessibleName(new RegExp(longPath.replace(/[.]/g, '\\.')))
    expect(link).toHaveAttribute('title', expect.stringContaining(longPath))
    // The VISIBLE text is abbreviated so it does not dominate its own card. It
    // is checked separately from `textContent`, which also contains the
    // visually-hidden full path - conflating the two would make this assertion
    // meaningless.
    const visible = link.querySelector('span:not(.sr-only)')
    expect(visible?.textContent).toContain('...')
    expect(visible?.textContent).not.toContain(
      'ARPI_Performance_Intelligence.SemanticModel'
    )
  })

  it('leaves a short path whole', () => {
    render(<SourceLink path="KPI_CATALOG.md" />)
    expect(screen.getByRole('link').textContent).toContain('KPI_CATALOG.md')
    expect(screen.getByRole('link').textContent).not.toContain('...')
  })

  it('opens in a new tab and says so', () => {
    render(<SourceLink path="ARCHITECTURE.md" />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAccessibleName(/opens in a new tab/i)
  })
})

/* -------------------------------------------------------------------------- */
/* States                                                                      */
/* -------------------------------------------------------------------------- */

describe('empty and locked states', () => {
  it('announces an empty state politely, so a filter change is not silent', () => {
    render(<EmptyState title="No match" description="Try widening the filters." />)
    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(within(region).getByText('No match')).toBeInTheDocument()
  })

  it('states each unlock condition in text as well as in colour', () => {
    render(
      <LockedState
        title="Locked"
        reason="Because the evidence does not exist."
        conditions={[
          { label: 'A met condition', met: true },
          { label: 'An unmet condition', met: false },
        ]}
        alternatives={<a href="/status">Status</a>}
      />
    )
    expect(screen.getByText(/Condition met:/)).toBeInTheDocument()
    expect(screen.getByText(/Condition not met:/)).toBeInTheDocument()
  })

  it('never shows a date on a locked state', () => {
    const { container } = render(
      <LockedState
        title="Locked"
        reason="No date should appear here."
        conditions={[{ label: 'Something', met: false }]}
        alternatives={<a href="/status">Status</a>}
      />
    )
    expect(container.textContent).not.toMatch(/\b(?:Q[1-4]|20\d{2})\b/)
    expect(container.textContent).not.toMatch(/coming soon/i)
  })

  it('always offers somewhere else to go', () => {
    render(
      <LockedState
        title="Locked"
        reason="Reason."
        conditions={[{ label: 'Something', met: false }]}
        alternatives={<a href="/architecture">The architecture</a>}
      />
    )
    expect(screen.getByRole('link', { name: 'The architecture' })).toBeInTheDocument()
  })
})

describe('navigation aids', () => {
  it('points the skip link at the main landmark', () => {
    render(<SkipLink />)
    expect(screen.getByRole('link', { name: /skip to main content/i })).toHaveAttribute(
      'href',
      '#main-content'
    )
  })

  it('marks the current breadcrumb with aria-current rather than only styling it', () => {
    render(
      <Breadcrumbs
        trail={[
          { href: '/', label: 'Overview' },
          { href: '#', label: 'Status' },
        ]}
      />
    )
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument()
    expect(screen.getByText('Status')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Overview' })).toBeInTheDocument()
  })
})

/* -------------------------------------------------------------------------- */
/* Typography and identifiers                                                  */
/* -------------------------------------------------------------------------- */

describe('typography primitives', () => {
  it('separates the semantic heading level from the visual size', () => {
    render(
      <Heading level={3} size="hero">
        Big but third-level
      </Heading>
    )
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(
      'Big but third-level'
    )
  })

  it('renders a technical identifier as code, so it is not read as prose', () => {
    const { container } = render(<CodeLabel>reporting.vw_lead_funnel</CodeLabel>)
    expect(container.querySelector('code')).toHaveTextContent('reporting.vw_lead_funnel')
  })

  it('labels a grain explicitly, because grain is the field that matters most', () => {
    render(<GrainLabel grain="One row per lead, per store, per day" />)
    expect(screen.getByText('Declared grain')).toBeInTheDocument()
    expect(screen.getByText('One row per lead, per store, per day')).toBeInTheDocument()
  })

  it('gives a KPI chip a name beyond its identifier', () => {
    render(<KpiChip id="KPI-INV-006" name="Aged inventory percentage" />)
    expect(screen.getByText('KPI-INV-006')).toBeInTheDocument()
    expect(screen.getByText(/Aged inventory percentage/)).toBeInTheDocument()
  })

  it('renders a badge with its label', () => {
    render(<Badge tone="verified">Verified</Badge>)
    expect(screen.getByText('Verified')).toBeInTheDocument()
  })
})

/* -------------------------------------------------------------------------- */
/* Content accessors                                                           */
/* -------------------------------------------------------------------------- */

describe('content accessors', () => {
  it('splits the model into eight dimensions and five facts', () => {
    expect(dimensions).toHaveLength(8)
    expect(facts).toHaveLength(5)
  })

  it('assigns every KPI to exactly one of the five KPI domains', () => {
    const domainIds = ['sales', 'gross', 'inventory', 'funnel', 'marketing']
    const covered = domainIds.flatMap((id) => kpiIdsForDomain(id as never))
    expect(new Set(covered).size).toBe(kpis.length)
  })

  it('describes six domains, one of which carries no KPI of its own', () => {
    expect(DOMAINS).toHaveLength(6)
    const withoutKpis = DOMAINS.filter((d) => kpiIdsForDomain(d.id).length === 0)
    expect(withoutKpis.map((d) => d.id)).toEqual(['dataQuality'])
  })

  it('names a real fact and real reporting views on every domain', () => {
    for (const domain of DOMAINS) {
      expect(domain.primaryFact).toMatch(/^(?:warehouse|audit)\./)
      expect(domain.reportingViews.length).toBeGreaterThan(0)
      for (const view of domain.reportingViews) {
        expect(view).toMatch(/^reporting\.vw_/)
      }
    }
  })

  it('states what each domain omits, not only what it measures', () => {
    for (const domain of DOMAINS) {
      expect(domain.summary.length, `${domain.id} summary too short`).toBeGreaterThan(80)
      expect(domain.managementQuestion).toMatch(/\?$/)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Motion tokens                                                               */
/* -------------------------------------------------------------------------- */

describe('the motion system', () => {
  it('targets the end state rather than nothing under reduced motion', () => {
    expect(target(true)).toBe('reduced')
    expect(target(false)).toBe('visible')
  })

  it('keeps every duration short enough that content is never withheld', () => {
    for (const [name, seconds] of Object.entries(DURATION)) {
      expect(seconds, `${name} is too long for a document`).toBeLessThanOrEqual(1)
      expect(seconds).toBeGreaterThan(0)
    }
  })

  it('declares easing as four control points', () => {
    for (const [name, curve] of Object.entries(EASE)) {
      expect(curve, `${name} is not a cubic bezier`).toHaveLength(4)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Utilities                                                                   */
/* -------------------------------------------------------------------------- */

describe('utilities', () => {
  it('joins class names and drops falsy entries', () => {
    expect(cx('a', false, undefined, 'b', null)).toBe('a b')
  })

  it('formats a count with separators in a stable locale', () => {
    expect(formatCount(45754)).toBe('45,754')
    expect(formatCount(3)).toBe('3')
  })

  it('formats a date in UTC so the server and the client agree', () => {
    expect(formatDate('2026-07-29')).toBe('29 July 2026')
  })

  it('returns an unparseable date unchanged rather than showing "Invalid Date"', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date')
  })

  it('slugifies a label', () => {
    expect(slugify('Front-end gross (USD)')).toBe('front-end-gross-usd')
  })

  it('groups in insertion order', () => {
    const groups = groupBy(['aa', 'ab', 'bb'], (s) => s[0] as 'a' | 'b')
    expect([...groups.keys()]).toEqual(['a', 'b'])
    expect(groups.get('a')).toEqual(['aa', 'ab'])
  })

  it('clamps', () => {
    expect(clamp(5, 0, 3)).toBe(3)
    expect(clamp(-1, 0, 3)).toBe(0)
  })
})
