/**
 * The hero. Chapter one.
 *
 * WHAT CHANGED IN THIS RELEASE, AND WHY
 * -------------------------------------
 * The hero's dominant visual used to be `GovernedSignal`, an abstract diagram of
 * six source systems converging on a governed stack. It is a good diagram. It is
 * still on this page, one chapter down, where it explains the governed stack to
 * a reader who has decided they care.
 *
 * What it could not do is answer the question that decides whether there is a
 * second screen at all: does any of this run? A visitor arriving from LinkedIn
 * met a headline, a paragraph and a drawing, and had to take the software on
 * trust. Four working experiences were linked from this page and none of them
 * was ever shown.
 *
 * The hero now opens with the product. `ProductShowcase` is a live surface over
 * the real sanitized listing snapshot: choosing a store filters it, five derived
 * figures change, four listings change, and the link into the explorer changes
 * with them. Underneath it, `LineageRail` says in four nodes where those rows
 * came from, so the demonstration and its provenance are on the same screen.
 *
 * WHAT IS ABOVE THE FOLD, AND WHY
 * -------------------------------
 * Six things, in this order, and nothing else:
 *
 *   1. whose business this is  the eyebrow, naming the group
 *   2. what the problem is     the headline, three sentences of six words
 *   3. why it is hard          two sentences naming the three stores
 *   4. who built it            one clause, naming Michael Palmer
 *   5. two ways in             one primary action, one secondary
 *   6. the trust position      one line, from <TrustLine>
 *   7. the working product     the frame
 *
 * THE HEADLINE IS PRODUCT-FIRST, AND IT DID NOT USED TO BE
 * -------------------------------------------------------
 * It used to read "Dealership intelligence built by someone who has run the
 * dealership." That is true, it is the strongest thing about the project, and it
 * was the wrong first sentence: it made the author the subject of the product's
 * home page. The headline now states the problem the software exists for.
 * "Three dealerships. Three operating models. One governed reporting layer."
 * names the business, names the difficulty and names the answer, in that order,
 * and every chapter below expands one of the three.
 *
 * The author positioning has not been deleted, it has been RELOCATED: it is the
 * whole subject of `/about`, it is chapter six of this page, and one clause of
 * it survives here as supporting credibility rather than as the proposition.
 *
 * THE IMPLEMENTATION-STATUS INDICATOR IS ONE LINE
 * ----------------------------------------------
 * `TrustLine` carries the synthetic-data statement, the fictional group and the
 * derived real-engine validation state, on a hairline rule. There is no status
 * badge here and there must not be: a product page that opens by reporting its
 * own risk has not said what it is yet, and the detail is one click away on the
 * page whose subject it is.
 *
 * WHAT IT DOES NOT SAY
 * --------------------
 * No superlative, no "revolutionary", no "powerful platform", no "actionable
 * insights", no em dash, and no figure that describes a business result.
 *
 * A SERVER COMPONENT WITH ONE CLIENT ISLAND
 * -----------------------------------------
 * Everything here renders on the server except `ProductShowcase`, which holds
 * the selection. It receives a preformatted payload of roughly two dozen rows
 * from `lib/product-preview` rather than importing the 541-record set, so the
 * home page's bundle carries the demonstration and not the dataset.
 */
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'

import { ApplicationFrame } from '@/components/media/application-frame'
import { LineageRail } from '@/components/media/lineage-rail'
import { ProductShowcase } from '@/components/media/product-showcase'
import { LinkButton } from '@/components/ui/button'
import { Container, Section } from '@/components/ui/layout'
import { TrustLine } from '@/components/ui/trust-line'
import { Eyebrow, Heading, Text } from '@/components/ui/typography'
import { inventoryPreviews } from '@/lib/product-preview'
import { ROUTES, SITE_AUTHOR } from '@/lib/site'
import { cx } from '@/lib/utils'

/**
 * The hero's identity block: eyebrow and headline.
 *
 * Exported separately so a layout can place it without the rest. The headline
 * spans the canvas and the two-column row sits under it: an earlier attempt put
 * it inside a five-column text block beside the visual, which at 1440px gave a
 * ten-word sentence a 460px measure and six lines of 76px type.
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
 * The hero's editorial block: supporting copy, attribution, two actions, one
 * trust line.
 *
 * THE ORDER IS THE POINT
 * ----------------------
 * Copy, then attribution, then actions, then the trust line. The disclosure
 * comes AFTER the two ways in, not before them. An earlier build put a bordered
 * validation caveat and a ruled synthetic-data paragraph above the buttons,
 * which is how the first call to action ended up roughly 1,050px down a phone
 * screen: the page asked the reader to accept two risk disclosures before it
 * offered them anything to do.
 */
export function HeroEditorial({ className }: { className?: string }) {
  return (
    <div className={cx('flex flex-col gap-6', className)}>
      <Text size="body" tone="secondary" className="max-w-prose">
        Granite Chevrolet of Nashua, Granite Subaru of Manchester and Granite Pre-Owned
        Center of Merrimack operate under different inventory realities. ARPI holds all
        three in one governed reporting layer.
      </Text>

      {/* The author positioning, as one clause and in a recessive tone. It is
          supporting credibility for the claim above it, not the claim itself,
          and the page it is the subject of is one link away.

          The technology list that used to close this clause is gone. It named
          four things this site can prove by being read, and `/about` maps eight
          capabilities to the files that carry them. */}
      <Text size="sm" tone="muted" className="max-w-prose">
        {`Built by ${SITE_AUTHOR} on more than 25 years in automotive retail. `}
        <Link
          href={ROUTES.about.href}
          className="underline decoration-dotted underline-offset-4 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
        >
          About the author
        </Link>
        .
      </Text>

      {/* Two actions, and only two. The primary one opens the experience the
          frame beside it is a slice of, because a visitor who has just watched a
          store filter is one click from doing it properly. The secondary one
          goes to the engineering, for the reader who wants to know how the rows
          got there. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <LinkButton
          href={ROUTES.inventory.href}
          variant="primary"
          size="lg"
          iconAfter={<ArrowRight />}
        >
          Open the inventory explorer
        </LinkButton>
        <LinkButton href={ROUTES.architecture.href} variant="secondary" size="lg">
          See how it is built
        </LinkButton>
      </div>

      <TrustLine variant="hero" scope="inventory" href={ROUTES.governance.href} />
    </div>
  )
}

/**
 * The signature product surface.
 *
 * A server-rendered frame around one client island. The chrome, the caption and
 * the lineage rail cost no JavaScript; only the selection does.
 */
export function HeroProduct({ className }: { className?: string }) {
  return (
    <div className={className}>
      <ApplicationFrame
        title="ARPI Inventory"
        path={ROUTES.inventory.href}
        provenance="live"
        note="Sanitized reference data"
        label="Live inventory surface for Granite Auto Group"
        bodyClassName="flex flex-col"
        caption="Choosing a store filters the sanitized listing snapshot this build derived from the workbooks in this repository. Every figure is counted from those rows. Listings are what a public source advertised at a capture date, not sales, deliveries or gross."
      >
        <ProductShowcase previews={inventoryPreviews} />
        <LineageRail />
      </ApplicationFrame>
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
      className="overflow-clip pt-10 pb-section-tight sm:pt-14"
    >
      {/* The dimensional-grid ground. Decorative, pointer-transparent, and
          removed from the accessibility tree. */}
      <div
        aria-hidden="true"
        className="grid-motif pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(75%_65%_at_25%_15%,black,transparent)]"
      />

      <Container width="wide">
        <HeroIdentity />

        <div className="mt-8 grid grid-cols-1 items-start gap-8 lg:mt-10 lg:grid-cols-12 lg:gap-10">
          <HeroEditorial className="lg:col-span-5" />
          <HeroProduct className="lg:col-span-7" />
        </div>
      </Container>
    </Section>
  )
}
