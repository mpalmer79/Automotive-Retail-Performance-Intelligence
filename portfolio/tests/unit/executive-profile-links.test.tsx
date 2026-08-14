/**
 * The Executive header's profile links, and the containment that keeps them there.
 *
 * TWO CLAIMS, AND THE SECOND ONE IS THE REASON THIS FILE EXISTS
 * ------------------------------------------------------------
 *   1. `/` renders a GitHub link and a LinkedIn link, with the attributes an external
 *      link must carry and an accessible name that does not depend on an icon.
 *   2. THE OTHER NINE OPERATING ROUTES DO NOT. `OperatingPageHeader` is one component
 *      across ten route files, so the cheapest way to ship these links was to type them
 *      into the shared header — which would have put one person's profile on the deal
 *      jacket, the inventory route and the accounting reconciliation. The slot exists to
 *      prevent that and this suite is what makes the prevention hold: it reads every
 *      operating page's source and asserts exactly one of them fills the slot.
 *
 * The layout half of the claim — that the pair occupies the band's upper right at 1440,
 * wraps at 768 and stacks full-width at 390 without overflowing — is in
 * `tests/e2e/executive-profile-links.spec.ts`, because jsdom has no layout engine and
 * would report a badge sitting on top of the disclosure as passing.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  EXECUTIVE_PROFILE_LINKS,
  ExecutiveProfileLinks,
} from '@/components/dashboard/profile-links'
import { OperatingPageHeader } from '@/components/dashboard/operating-page-header'
import {
  AUTHOR_PROFILE_URL,
  REPOSITORY_URL,
  SYNTHETIC_DATA_STATEMENT,
  SYNTHETIC_DEMO_SHORT,
} from '@/lib/site'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function source(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8')
}

/** Every operating route file. Listed rather than globbed: a route added without a
 *  decision about this slot should fail here, not be swept up silently. */
const OPERATING_PAGES = [
  'src/app/(operating)/page.tsx',
  'src/app/(operating)/dashboard/accounting/page.tsx',
  'src/app/(operating)/dashboard/actions/page.tsx',
  'src/app/(operating)/dashboard/deals/page.tsx',
  'src/app/(operating)/dashboard/deals/[saleId]/page.tsx',
  'src/app/(operating)/dashboard/employees/page.tsx',
  'src/app/(operating)/dashboard/fi/page.tsx',
  'src/app/(operating)/dashboard/inventory/page.tsx',
  'src/app/(operating)/dashboard/leads-marketing/page.tsx',
  'src/app/(operating)/dashboard/sales-gross/page.tsx',
] as const

const EXECUTIVE_PAGE = 'src/app/(operating)/page.tsx'

afterEach(cleanup)

/* -------------------------------------------------------------------------- */
/* The links themselves                                                        */
/* -------------------------------------------------------------------------- */

describe('the Executive profile links', () => {
  it('are the repository and the author profile, from the shared constants', () => {
    // Asserted against `lib/site.ts` rather than against a URL typed a second time
    // here: a test that repeats the string only proves the two strings match.
    expect(EXECUTIVE_PROFILE_LINKS.map((link) => link.href)).toEqual([
      REPOSITORY_URL,
      AUTHOR_PROFILE_URL,
    ])
    expect(REPOSITORY_URL).toBe(
      'https://github.com/mpalmer79/Automotive-Retail-Performance-Intelligence'
    )
    expect(AUTHOR_PROFILE_URL).toBe('https://www.linkedin.com/in/mpalmer1234/')
  })

  it('render as two anchors with names that survive the icon being unavailable', () => {
    render(<ExecutiveProfileLinks />)

    const repository = screen.getByRole('link', { name: /GitHub Repository/i })
    const profile = screen.getByRole('link', { name: /LinkedIn Profile/i })

    expect(repository).toHaveAttribute('href', REPOSITORY_URL)
    expect(profile).toHaveAttribute('href', AUTHOR_PROFILE_URL)
    // The label is text, not a title attribute and not an icon: a control whose
    // meaning lives in a glyph is unreadable to a screen reader and ambiguous to
    // anyone who has not learned the convention.
    expect(repository).toHaveTextContent('GitHub Repository')
    expect(profile).toHaveTextContent('LinkedIn Profile')
  })

  it('open in a new tab and say so in the accessible name', () => {
    render(<ExecutiveProfileLinks />)

    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveAttribute('target', '_blank')
      // `noopener` denies the opened document a handle on this one. `noreferrer` is
      // deliberate too: neither destination needs to know which page sent the visitor.
      const rel = link.getAttribute('rel') ?? ''
      expect(rel.split(/\s+/)).toEqual(expect.arrayContaining(['noopener', 'noreferrer']))
      expect(link).toHaveAccessibleName(/opens in a new tab/i)
    }
  })

  it('are anchors, so they are keyboard reachable without any script', () => {
    const { container } = render(<ExecutiveProfileLinks />)

    const anchors = [...container.querySelectorAll('a')]
    expect(anchors).toHaveLength(2)
    for (const anchor of anchors) {
      // No `tabindex`, no `role` override, no handler. A plain anchor with an href is
      // in the tab order and takes the site's one focus ring from `globals.css`; the
      // three ways to break that are all absent rather than merely unused.
      expect(anchor.hasAttribute('tabindex')).toBe(false)
      expect(anchor.hasAttribute('role')).toBe(false)
      expect(anchor.getAttribute('href')).toBeTruthy()
    }
    expect(container.querySelector('button')).toBeNull()
  })

  it('hide their icons from assistive technology', () => {
    const { container } = render(<ExecutiveProfileLinks />)

    for (const svg of container.querySelectorAll('svg')) {
      expect(svg.getAttribute('aria-hidden')).toBe('true')
    }
  })
})

/* -------------------------------------------------------------------------- */
/* The slot                                                                    */
/* -------------------------------------------------------------------------- */

describe('the header action slot', () => {
  const band = { title: 'Executive', context: 'All three stores' }

  it('renders nothing when a route passes no actions', () => {
    const { container } = render(<OperatingPageHeader {...band} />)
    expect(container.querySelector('[data-profile-links]')).toBeNull()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('renders the actions after the methodology disclosure, in document order', () => {
    const { container } = render(
      <OperatingPageHeader
        {...band}
        methodologyId="trust"
        methodology={<p>How the figures are produced.</p>}
        headerActions={<ExecutiveProfileLinks />}
      />
    )

    const disclosure = container.querySelector('#trust')
    const links = container.querySelector('[data-profile-links]')
    expect(disclosure).not.toBeNull()
    expect(links).not.toBeNull()

    // `DOCUMENT_POSITION_FOLLOWING` from the disclosure to the links: the
    // synthetic-data statement is reached first by a screen reader, by the tab order
    // and by a phone reading the band top to bottom. The links are secondary and the
    // reading order is where that is guaranteed.
    const relation = disclosure!.compareDocumentPosition(links!)
    expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('leaves the synthetic-data disclosure whole', () => {
    render(
      <OperatingPageHeader
        {...band}
        methodologyId="trust"
        methodology={<p>How the figures are produced.</p>}
        headerActions={<ExecutiveProfileLinks />}
      />
    )

    // The compact statement is the summary's own text and the full statement is inside
    // the disclosure. Adding a secondary control beside it may not shorten, hide or
    // displace either; `content-integrity` owns the wording and this owns the presence.
    const summary = screen.getByText(SYNTHETIC_DEMO_SHORT)
    expect(summary).toBeVisible()
    expect(
      within(summary.closest('details')!).getByText(SYNTHETIC_DATA_STATEMENT)
    ).toBeTruthy()
  })
})

/* -------------------------------------------------------------------------- */
/* Containment                                                                 */
/* -------------------------------------------------------------------------- */

describe('containment across the operating routes', () => {
  it('is filled by the Executive route', () => {
    const page = source(EXECUTIVE_PAGE)
    expect(page).toContain('headerActions={<ExecutiveProfileLinks />}')
    expect(page).toContain("from '@/components/dashboard/profile-links'")
  })

  it('is filled by no other operating route', () => {
    const filled = OPERATING_PAGES.filter((path) =>
      source(path).includes('headerActions')
    )
    expect(filled).toEqual([EXECUTIVE_PAGE])
  })

  it('puts no profile link into the shared header itself', () => {
    // The containment is worthless if the next change types the URLs into the shell.
    const header = source('src/components/dashboard/operating-page-header.tsx')
    expect(header).not.toContain('linkedin.com')
    expect(header).not.toContain('AUTHOR_PROFILE_URL')
  })
})
