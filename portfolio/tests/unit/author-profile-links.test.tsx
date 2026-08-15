/**
 * The author's profile links, the three destinations they are NOT allowed to blur,
 * and the containment that keeps the pair off nine operating routes.
 *
 * THE CLAIM THIS FILE EXISTS FOR
 * ------------------------------
 * ARPI has three external destinations and they answer three different questions:
 *
 *   Michael Palmer / GitHub Portfolio   https://github.com/mpalmer79
 *   Michael Palmer / LinkedIn Profile   https://www.linkedin.com/in/mpalmer1234/
 *   ARPI / Source repository            .../Automotive-Retail-Performance-Intelligence
 *
 * They were two, and the badge labelled "GitHub" pointed at the third: a reader who
 * wanted to see what else the author had built landed on the project they were
 * already reading. Every assertion below is ultimately about keeping those three
 * apart - in the constants, in the shared component, in the five placements, and in
 * the operating routes that must carry none of them.
 *
 * THE OTHER NINE OPERATING ROUTES DO NOT CARRY THE PAIR. `OperatingPageHeader` is one
 * component across ten route files, so the cheapest way to ship these links was to
 * type them into the shared header - which would have put one person's profile on the
 * deal jacket, the inventory route and the accounting reconciliation. The slot exists
 * to prevent that and this suite is what makes the prevention hold.
 *
 * The layout half of the claim - that the pair occupies the band's upper right at
 * 1440, wraps at 768 and stacks full-width at 390 without overflowing, and that the
 * masthead does not overflow at 320 - is in
 * `tests/e2e/author-profile-links.spec.ts`, because jsdom has no layout engine and
 * would report a badge sitting on top of the disclosure as passing.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { OperatingPageHeader } from '@/components/dashboard/operating-page-header'
import {
  AUTHOR_PROFILE_LINKS,
  AuthorProfileLinks,
} from '@/components/profile/author-profile-links'
import { PageHeader } from '@/components/ui/page-header'
import { InlineLink } from '@/components/ui/inline-link'
import {
  AUTHOR_GITHUB_URL,
  AUTHOR_LINKEDIN_URL,
  REPOSITORY_URL,
  SITE_AUTHOR,
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
const ABOUT_PAGE = 'src/app/(site)/about/page.tsx'
const SITE_HEADER = 'src/components/shell/site-header.tsx'
const SITE_FOOTER = 'src/components/shell/site-footer.tsx'
const SHARED_COMPONENT = 'src/components/profile/author-profile-links.tsx'

afterEach(cleanup)

/* -------------------------------------------------------------------------- */
/* The three destinations                                                      */
/* -------------------------------------------------------------------------- */

describe('the three external destinations', () => {
  it('are three distinct URLs, and the profile pair is not the repository', () => {
    expect(AUTHOR_GITHUB_URL).toBe('https://github.com/mpalmer79')
    expect(AUTHOR_LINKEDIN_URL).toBe('https://www.linkedin.com/in/mpalmer1234/')
    expect(REPOSITORY_URL).toBe(
      'https://github.com/mpalmer79/Automotive-Retail-Performance-Intelligence'
    )

    // The regression this file is named for: the author badge pointing at ARPI.
    expect(AUTHOR_GITHUB_URL).not.toBe(REPOSITORY_URL)
    expect(new Set([AUTHOR_GITHUB_URL, AUTHOR_LINKEDIN_URL, REPOSITORY_URL]).size).toBe(3)
  })

  it('no longer expose the ambiguous `AUTHOR_PROFILE_URL` alias', async () => {
    // Two profiles exist now, so a constant named "the author's profile" cannot say
    // which one it means. The migration is only finished when the old name is gone.
    const site: Record<string, unknown> = await import('@/lib/site')
    expect(Object.keys(site)).not.toContain('AUTHOR_PROFILE_URL')
    expect(source('src/lib/site.ts')).not.toMatch(/^export const AUTHOR_PROFILE_URL/m)
  })

  it('are the shared table, in the order the site renders them', () => {
    // Asserted against `lib/site.ts` rather than against a URL typed a second time
    // here: a test that repeats the string only proves the two strings match.
    expect(AUTHOR_PROFILE_LINKS.map((link) => link.href)).toEqual([
      AUTHOR_GITHUB_URL,
      AUTHOR_LINKEDIN_URL,
    ])
    expect(AUTHOR_PROFILE_LINKS.map((link) => link.label)).toEqual([
      'GitHub Portfolio',
      'LinkedIn Profile',
    ])
    expect(AUTHOR_PROFILE_LINKS.map((link) => link.accessibleName)).toEqual([
      `${SITE_AUTHOR} on GitHub`,
      `${SITE_AUTHOR} on LinkedIn`,
    ])
  })
})

/* -------------------------------------------------------------------------- */
/* The badge variant                                                           */
/* -------------------------------------------------------------------------- */

describe('the badge variant', () => {
  it('renders two anchors whose names survive the icon being unavailable', () => {
    render(<AuthorProfileLinks />)

    const portfolio = screen.getByRole('link', { name: /GitHub Portfolio/i })
    const profile = screen.getByRole('link', { name: /LinkedIn Profile/i })

    expect(portfolio).toHaveAttribute('href', AUTHOR_GITHUB_URL)
    expect(profile).toHaveAttribute('href', AUTHOR_LINKEDIN_URL)
    // The label is text, not a title attribute and not an icon: a control whose
    // meaning lives in a glyph is unreadable to a screen reader and ambiguous to
    // anyone who has not learned the convention.
    expect(portfolio).toHaveTextContent('GitHub Portfolio')
    expect(profile).toHaveTextContent('LinkedIn Profile')
  })

  it('sends the GitHub badge to the profile and never to the repository', () => {
    render(<AuthorProfileLinks />)

    expect(screen.getByRole('link', { name: /GitHub Portfolio/i })).not.toHaveAttribute(
      'href',
      REPOSITORY_URL
    )
    expect(screen.queryByRole('link', { name: /GitHub Repository/i })).toBeNull()
  })

  it('opens in a new tab and says so in the accessible name', () => {
    render(<AuthorProfileLinks />)

    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveAttribute('target', '_blank')
      // `noopener` denies the opened document a handle on this one. `noreferrer` is
      // deliberate too: neither destination needs to know which page sent the visitor.
      const rel = link.getAttribute('rel') ?? ''
      expect(rel.split(/\s+/)).toEqual(expect.arrayContaining(['noopener', 'noreferrer']))
      expect(link).toHaveAccessibleName(/opens in a new tab/i)
    }
  })

  it('is anchors, so it is keyboard reachable without any script', () => {
    const { container } = render(<AuthorProfileLinks />)

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

  it('hides its icons from assistive technology', () => {
    const { container } = render(<AuthorProfileLinks />)

    for (const svg of container.querySelectorAll('svg')) {
      expect(svg.getAttribute('aria-hidden')).toBe('true')
    }
  })
})

/* -------------------------------------------------------------------------- */
/* The compact variant                                                         */
/* -------------------------------------------------------------------------- */

describe('the compact variant', () => {
  it('keeps the destinations and moves the label into the accessible name', () => {
    render(<AuthorProfileLinks variant="compact" />)

    const github = screen.getByRole('link', {
      name: new RegExp(`${SITE_AUTHOR} on GitHub`, 'i'),
    })
    const linkedin = screen.getByRole('link', {
      name: new RegExp(`${SITE_AUTHOR} on LinkedIn`, 'i'),
    })

    expect(github).toHaveAttribute('href', AUTHOR_GITHUB_URL)
    expect(linkedin).toHaveAttribute('href', AUTHOR_LINKEDIN_URL)

    for (const link of [github, linkedin]) {
      // A bare glyph is not a control. The name says who as well as where, because
      // the masthead has no headline beside it to supply the person.
      expect(link).toHaveAccessibleName(/opens in a new tab/i)
      expect(link).toHaveAttribute('target', '_blank')
      expect(link.getAttribute('rel') ?? '').toContain('noopener')
      // The tooltip is the same sentence, for a pointer user who hovers.
      expect(link).toHaveAttribute('title', expect.stringContaining(SITE_AUTHOR))
    }
  })

  it('shows no visible label text, which is the only difference that is allowed', () => {
    const { container } = render(<AuthorProfileLinks variant="compact" />)

    // Everything textual inside a compact control is screen-reader only, so the
    // masthead stays a row of two marks rather than two labelled buttons.
    for (const anchor of container.querySelectorAll('a')) {
      for (const span of anchor.querySelectorAll('span')) {
        expect(span.className).toContain('sr-only')
      }
    }
  })

  it('uses the same brand marks as the badges rather than a generic glyph', () => {
    const badges = render(<AuthorProfileLinks />).container
    const compact = render(<AuthorProfileLinks variant="compact" />).container

    const paths = (root: Element) =>
      [...root.querySelectorAll('svg path')].map((node) => node.getAttribute('d'))

    // Identity is shared; only layout and density differ. The badge variant renders a
    // third decorative glyph (the external-link arrow) that the compact one does not,
    // so the compact marks are asserted as a subset rather than as an equal set.
    for (const d of paths(compact)) {
      expect(paths(badges)).toContain(d)
    }
    expect(paths(compact)).toHaveLength(2)
  })
})

/* -------------------------------------------------------------------------- */
/* The header action slot                                                      */
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
        headerActions={<AuthorProfileLinks />}
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
        headerActions={<AuthorProfileLinks />}
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
    expect(page).toContain('headerActions={<AuthorProfileLinks />}')
    expect(page).toContain("from '@/components/profile/author-profile-links'")
  })

  it('is filled by no other operating route', () => {
    const filled = OPERATING_PAGES.filter((path) =>
      source(path).includes('headerActions')
    )
    expect(filled).toEqual([EXECUTIVE_PAGE])
  })

  it('puts no profile link into the shared operating header itself', () => {
    // The containment is worthless if the next change types the URLs into the shell.
    const header = source('src/components/dashboard/operating-page-header.tsx')
    expect(header).not.toContain('linkedin.com')
    expect(header).not.toContain('AUTHOR_LINKEDIN_URL')
    expect(header).not.toContain('AUTHOR_GITHUB_URL')
  })
})

/* -------------------------------------------------------------------------- */
/* One component, five placements                                              */
/* -------------------------------------------------------------------------- */

describe('brand consistency', () => {
  const PLACEMENTS = [EXECUTIVE_PAGE, ABOUT_PAGE, SITE_HEADER, SITE_FOOTER] as const

  it('renders the shared component in every placement rather than local JSX', () => {
    for (const path of PLACEMENTS) {
      const text = source(path)
      expect(text, `${path} does not import the shared profile component`).toContain(
        "from '@/components/profile/author-profile-links'"
      )
      expect(text, `${path} does not render it`).toContain('<AuthorProfileLinks')
    }
  })

  it('draws the two brand marks in exactly one file', () => {
    // The LinkedIn glyph's opening command is distinctive enough to find a second
    // copy of the mark anywhere in the tree, which is what a duplicated
    // implementation looks like before it starts to drift.
    const offenders = PLACEMENTS.filter((path) =>
      source(path).includes('viewBox="0 0 24 24"')
    )
    expect(offenders).toEqual([])
    expect(source(SHARED_COMPONENT)).toContain('M20.45 20.45h-3.56')
  })

  it('types neither profile URL as a literal outside `lib/site.ts`', () => {
    const files = [...PLACEMENTS, SHARED_COMPONENT]
    for (const path of files) {
      const text = source(path)
      expect(text, `${path} hard-codes the LinkedIn URL`).not.toContain(
        'linkedin.com/in/'
      )
      expect(text, `${path} hard-codes the GitHub profile URL`).not.toContain(
        'https://github.com/mpalmer79'
      )
    }
  })
})

/* -------------------------------------------------------------------------- */
/* The masthead and the footer                                                 */
/* -------------------------------------------------------------------------- */

describe('the site masthead', () => {
  const header = () => source(SITE_HEADER)

  it('carries the compact pair rather than a repository surrogate', () => {
    expect(header()).toContain('<AuthorProfileLinks variant="compact" />')
    // The folder glyph standing in for a GitHub link is gone, and so is the
    // repository URL it pointed at: the masthead is the author's action area now.
    expect(header()).not.toContain('FolderGit2')
    expect(header()).not.toContain('REPOSITORY_URL')
  })

  it('gives the mobile drawer labelled badges under the author’s name', () => {
    // Requirement, not preference: a drawer of unlabelled icons is the one place the
    // compact variant would be wrong, because there is room for the words.
    const text = header()
    const drawer = text.slice(text.indexOf('id="mobile-navigation"'))
    expect(drawer).toContain('SITE_AUTHOR')
    expect(drawer).toContain('<AuthorProfileLinks />')
  })
})

describe('the footer', () => {
  const footer = () => source(SITE_FOOTER)

  it('keeps the ARPI source repository as its own control', () => {
    // The distinction the whole increment is about: the repository button was NOT
    // replaced by the GitHub portfolio badge, because they are different destinations.
    expect(footer()).toContain('Source repository')
    expect(footer()).toContain('href={REPOSITORY_URL}')
  })

  it('places the author badges after it, not instead of it', () => {
    const text = footer()
    expect(text.indexOf('Source repository')).toBeLessThan(
      text.indexOf('<AuthorProfileLinks />')
    )
  })
})

/* -------------------------------------------------------------------------- */
/* The About header                                                            */
/* -------------------------------------------------------------------------- */

describe('the About page header', () => {
  const about = () => source(ABOUT_PAGE)

  it('names the author in the eyebrow and keeps the headline intact', () => {
    expect(about()).toContain('eyebrow={SITE_AUTHOR}')
    expect(about()).toContain(
      'title="Dealership intelligence built by someone who has run the dealership"'
    )
    // The name was NOT appended to the headline; it sits above it in the hierarchy.
    expect(about()).not.toContain('run the dealership - Michael Palmer')
  })

  it('shortens the breadcrumb to the destination name', () => {
    expect(about()).toContain('crumbLabel="About"')
  })

  it('links both profiles inline and carries the badges in the meta row', () => {
    const text = about()
    expect(text).toContain('href={AUTHOR_GITHUB_URL}')
    expect(text).toContain('href={AUTHOR_LINKEDIN_URL}')
    expect(text).toContain('GitHub portfolio')
    expect(text).toContain('LinkedIn profile')
    expect(text).toContain('meta={<AuthorProfileLinks />}')
  })

  it('drops the design-history paragraph and gets shorter, not longer', () => {
    const text = about()
    // The removed sentence explained the site's own editing history to a visitor.
    expect(text).not.toContain("ARPI home page's headline")
    expect(text).not.toContain('the right claim in the wrong place')
  })

  it('keeps the repository evidence links on the page, moved rather than deleted', () => {
    const text = about()
    expect(text).toContain('path="README.md" field="author"')
    expect(text).toContain('path="docs/research.md"')
    // ...and out of the hero, where they competed with the profile badges.
    const header = text.slice(text.indexOf('<PageHeader'), text.indexOf('</Canvas>'))
    const heroEnd = header.indexOf('meta={<AuthorProfileLinks />}')
    expect(header.slice(0, heroEnd)).not.toContain('SourceLink')
  })
})

/* -------------------------------------------------------------------------- */
/* PageHeader's widened props                                                  */
/* -------------------------------------------------------------------------- */

describe('PageHeader accepts inline content without forking', () => {
  const base = { eyebrow: 'Michael Palmer', title: 'A headline' }

  it('still renders a plain string lede and supporting paragraph', () => {
    render(<PageHeader {...base} lede="A lede." supporting="A supporting line." />)

    expect(screen.getByText('A lede.')).toBeVisible()
    expect(screen.getByText('A supporting line.')).toBeVisible()
  })

  it('renders an element lede with a real anchor inside the paragraph', () => {
    render(
      <PageHeader
        {...base}
        lede={
          <>
            Explore my{' '}
            <InlineLink href={AUTHOR_GITHUB_URL} external>
              GitHub portfolio
            </InlineLink>
            .
          </>
        }
        supporting={
          <>
            Visit my{' '}
            <InlineLink href={AUTHOR_LINKEDIN_URL} external>
              LinkedIn profile
            </InlineLink>
            .
          </>
        }
      />
    )

    const github = screen.getByRole('link', { name: /GitHub portfolio/i })
    const linkedin = screen.getByRole('link', { name: /LinkedIn profile/i })

    expect(github).toHaveAttribute('href', AUTHOR_GITHUB_URL)
    expect(linkedin).toHaveAttribute('href', AUTHOR_LINKEDIN_URL)
    for (const link of [github, linkedin]) {
      expect(link).toHaveAttribute('target', '_blank')
      expect(link.getAttribute('rel') ?? '').toContain('noreferrer')
      expect(link).toHaveAccessibleName(/opens in a new tab/i)
      // Inside the paragraph, not lifted out of it: the lede is still one <p>.
      expect(link.closest('p')).not.toBeNull()
    }
  })

  it('keeps exactly one h1 and the breadcrumb label it was given', () => {
    const { container } = render(
      <PageHeader {...base} lede={<>A lede.</>} crumbLabel="About" />
    )

    expect(container.querySelectorAll('h1')).toHaveLength(1)
    expect(screen.getByText('About')).toBeVisible()
    expect(screen.queryByText('A headline', { selector: 'nav *' })).toBeNull()
  })

  it('renders no HTML from a string', () => {
    // The prop is `ReactNode`, and the widening may never become an injection point.
    // Matched with the `=` so the component's own docstring, which names the escape
    // hatch in order to rule it out, does not trip its own guard.
    expect(source('src/components/ui/page-header.tsx')).not.toContain(
      'dangerouslySetInnerHTML='
    )

    render(<PageHeader {...base} lede={'<em>markup</em> in a string'} />)
    expect(screen.getByText('<em>markup</em> in a string')).toBeVisible()
    expect(document.querySelector('em')).toBeNull()
  })
})
