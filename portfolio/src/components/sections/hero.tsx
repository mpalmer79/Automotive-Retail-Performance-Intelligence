/**
 * The hero. Chapter one.
 *
 * A server component. Nothing in it is interactive and its motion is CSS on an
 * SVG, so it ships no JavaScript at all - where the hero it replaces pulled the
 * animation library onto the site's most-visited route to draw a diagram.
 *
 * WHAT IS ABOVE THE FOLD, AND WHY
 * -------------------------------
 * Six things, in this order, and nothing else:
 *
 *   1. whose business this is  the eyebrow, naming the group
 *   2. what the problem is     the headline, three sentences of six words
 *   3. why it is hard          two sentences naming the three stores
 *   4. two ways in             one primary action, one secondary
 *   5. the trust position      one line, from <TrustLine>
 *   6. the signature visual
 *
 * THE HEADLINE IS PRODUCT-FIRST, AND IT DID NOT USED TO BE
 * -------------------------------------------------------
 * It used to read "Dealership intelligence built by someone who has run the
 * dealership." That is true, it is the strongest thing about the project, and it
 * was the wrong first sentence: it made the author the subject of the product's
 * home page. A visitor arrived, read a biography, and left without learning what
 * ARPI models or why the modelling is difficult.
 *
 * The headline now states the problem the software exists for. "Three
 * dealerships. Three operating models. One governed reporting layer." names the
 * business, names the difficulty and names the answer, in that order, and every
 * section below it expands one of the three.
 *
 * The author positioning has not been deleted, it has been RELOCATED. It is the
 * whole subject of `/about`, it is the closing argument of the domain-judgement
 * chapter, and one clause of it survives here as supporting credibility rather
 * than as the proposition. That is the distinction the information architecture
 * turns on: experience is why the answers are good, not what the product is.
 *
 * WHAT IT DOES NOT SAY
 * --------------------
 * No superlative, no "revolutionary", no "powerful platform", no "actionable
 * insights", no em dash. No status badge and no disclaimer panel: the trust
 * position is one line, and the detail is one click away on the page whose
 * subject it is.
 */
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'

import { LinkButton } from '@/components/ui/button'
import { Container, Section } from '@/components/ui/layout'
import { TrustLine } from '@/components/ui/trust-line'
import { Eyebrow, Heading, Text } from '@/components/ui/typography'
import { GovernedSignal } from '@/components/visuals/governed-signal'
import { ROUTES } from '@/lib/site'
import { cx } from '@/lib/utils'

/**
 * The hero's identity block: eyebrow and headline.
 *
 * Exported separately so a layout can place it without the rest. Layout B puts
 * it in an editorial panel beside the product; layout A keeps it spanning the
 * canvas above a two-column row.
 */
export function HeroIdentity({ className }: { className?: string }) {
  return (
    <div className={cx('flex flex-col gap-5', className)}>
      <Eyebrow tone="accent" rule>
        Granite Auto Group
      </Eyebrow>
      <Heading level={1} size="hero" className="max-w-5xl text-balance">
        Three dealerships. Three operating models. One governed reporting layer.
      </Heading>
    </div>
  )
}

/**
 * The hero's editorial block: supporting copy, two actions, one trust line.
 *
 * THE ORDER IS THE POINT
 * ----------------------
 * Copy, then actions, then the trust line. The disclosure comes AFTER the two
 * ways in, not before them. An earlier build put a bordered validation caveat
 * and a ruled synthetic-data paragraph above the buttons, which is how the
 * first call to action ended up roughly 1,050px down a phone screen: the page
 * asked the reader to accept two risk disclosures before it offered them
 * anything to do. The disclosure is still on the first screen and still one
 * line; it simply is not the thing standing between the headline and the
 * button.
 */
export function HeroEditorial({ className }: { className?: string }) {
  return (
    <div className={cx('flex flex-col gap-6', className)}>
      <Text size="body" tone="secondary" className="max-w-prose">
        Granite Chevrolet of Nashua, Granite Subaru of Manchester and Granite Pre-Owned
        Center of Merrimack operate under different inventory realities. ARPI preserves
        those differences while giving the group one trusted analytical foundation.
      </Text>

      {/* The author positioning, as one clause and in a recessive tone.
          It is supporting credibility for the claim above it, not the claim
          itself, and the page it is the subject of is one link away. */}
      <Text size="sm" tone="muted" className="max-w-prose">
        Built on more than 25 years in automotive retail, joined to PostgreSQL, Python,
        governed KPI definitions and a source-controlled Power BI model.{' '}
        <Link
          href={ROUTES.about.href}
          className="underline decoration-dotted underline-offset-4 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
        >
          About the author
        </Link>
        .
      </Text>

      {/* Two actions, and only two. Both stay on this page, because this page is
          now the group overview rather than an index of other pages: a visitor
          who wants the stores wants them here, and a visitor who wants the
          argument for the reporting layer wants that here too. The repository
          link moved to the header icon and to the evidence chapter, where a
          reviewer looking for source is already looking. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <LinkButton href="#stores" variant="primary" size="lg" iconAfter={<ArrowRight />}>
          Explore the three stores
        </LinkButton>
        <LinkButton href="#governed-group" variant="secondary" size="lg">
          See how ARPI works
        </LinkButton>
      </div>

      <TrustLine variant="hero" href={ROUTES.governance.href} className="mt-1" />
    </div>
  )
}

/**
 * The signature visual.
 *
 * Renders a portrait composition below `sm` and a landscape one above, rather
 * than one diagram scaled to both. See the comment at the top of
 * `governed-signal.tsx`: the first attempt let the landscape one bleed off the
 * right edge on a phone, which produced 85px of real horizontal page scroll at
 * 375px.
 */
export function HeroProduct({ className }: { className?: string }) {
  return (
    <div className={className}>
      <GovernedSignal />
    </div>
  )
}

export function Hero() {
  return (
    <Section
      // A stable hook for the content-integrity suite. It used to find the hero
      // with `main > section:first-of-type`, which stopped matching the moment
      // the floating canvas put two wrapper elements between them - and stopped
      // matching SILENTLY: a locator that resolves to nothing makes a
      // "there are no status badges here" assertion pass by finding no
      // elements at all. An id is a contract; a structural path is a guess
      // about markup that the next layout change invalidates.
      id="hero"
      rhythm="none"
      tone="cinematic"
      className="overflow-clip pt-12 pb-section-tight sm:pt-16"
    >
      {/* The dimensional-grid ground. Decorative, pointer-transparent, and
          removed from the accessibility tree. */}
      <div
        aria-hidden="true"
        className="grid-motif pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(75%_65%_at_25%_15%,black,transparent)]"
      />

      <Container width="wide">
        {/*
        The headline spans the canvas, and the two-column row sits under it.

        The first attempt put the headline inside a five-column text block beside
        the visual, which at 1440px gave a ten-word sentence a 460px measure: six
        lines of 76px type filling the whole left half, with the diagram pushed
        into the dead space beside it. Giving the sentence the full width lets it
        set in three balanced lines at a size that still reads as a headline, and
        gives the visual a column worth having.
      */}
        <HeroIdentity />

        <div className="mt-10 grid grid-cols-1 items-start gap-10 lg:mt-12 lg:grid-cols-12 lg:gap-12">
          <HeroEditorial className="lg:col-span-5" />
          <HeroProduct className="lg:col-span-7" />
        </div>
      </Container>
    </Section>
  )
}
