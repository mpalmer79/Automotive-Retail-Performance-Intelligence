/**
 * The hero. Chapter one of six.
 *
 * A server component. Nothing in it is interactive and its motion is CSS on an
 * SVG, so it ships no JavaScript at all - where the hero it replaces pulled the
 * animation library onto the site's most-visited route to draw a diagram.
 *
 * WHAT IS ABOVE THE FOLD, AND WHY
 * -------------------------------
 * Six things, in this order, and nothing else:
 *
 *   1. what this is        the eyebrow, three words
 *   2. who built it        the headline, which leads with the differentiator
 *   3. what it does        two sentences naming the systems and the domains
 *   4. two ways in         one primary action, one secondary
 *   5. the trust position  one line, from <TrustLine>
 *   6. the signature visual
 *
 * The previous hero had nine competing elements: an eyebrow, a headline, a
 * description, two status badges, a bordered validation caveat, a ruled
 * synthetic-data paragraph, two buttons, a diagram and a three-item legend. Its
 * first call to action sat roughly 550px down on a desktop and roughly 1,050px
 * down on a phone, below two separate risk disclosures. Findings A-01 and B-07.
 *
 * THE HEADLINE
 * ------------
 * "Dealership intelligence built by someone who has run the dealership."
 *
 * It leads with the one thing about this project that a better engineer cannot
 * replicate: twenty-five years of operating the business being modelled. Every
 * other analytics portfolio is built by somebody who learned the domain from a
 * dataset, and the sentence says so without saying it.
 *
 * WHAT IT DOES NOT SAY
 * --------------------
 * No superlative, no "revolutionary", no "powerful platform", no "actionable
 * insights", no em dash. No status badge and no disclaimer panel: the trust
 * position is one line, and the detail is one click away on the page whose
 * subject it is.
 */
import { ArrowRight, FolderGit2 } from 'lucide-react'

import { LinkButton } from '@/components/ui/button'
import { Container, Section } from '@/components/ui/layout'
import { TrustLine } from '@/components/ui/trust-line'
import { Eyebrow, Heading, Text } from '@/components/ui/typography'
import { GovernedSignal } from '@/components/visuals/governed-signal'
import { REPOSITORY_URL, ROUTES } from '@/lib/site'
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
        Automotive retail performance intelligence
      </Eyebrow>
      <Heading level={1} size="hero" className="max-w-5xl text-balance">
        Dealership intelligence built by someone who has run the dealership.
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
        More than 25 years of automotive retail experience, joined to PostgreSQL, Python,
        governed KPIs and Power BI architecture. Sales, gross, inventory, leads and
        marketing each get one definition, and every number on this site links to the file
        that proves it.
      </Text>

      {/* Two actions, and only two. The primary opens the product surface
          further down the page, because a visitor who has read this far wants to
          see the thing rather than read more about it. The secondary goes to the
          source, because a reviewer who believes none of this wants the
          repository and should not have to hunt for it. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <LinkButton
          href="#operating-view"
          variant="primary"
          size="lg"
          iconAfter={<ArrowRight />}
        >
          Explore the platform
        </LinkButton>
        <LinkButton
          href={REPOSITORY_URL}
          variant="secondary"
          size="lg"
          external
          iconBefore={<FolderGit2 />}
        >
          View engineering evidence
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
