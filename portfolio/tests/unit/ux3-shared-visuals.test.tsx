/**
 * `UX.3` — the shared visual primitives, and the properties that make them
 * honest rather than decorative.
 *
 * These components exist because seven reference routes were each rebuilding the
 * same three shapes out of paragraphs. The risk in consolidating them is that a
 * diagram makes a claim more confidently than the sentence it replaced, so the
 * assertions below are mostly about what the components MAY NOT do:
 *
 *   - a stage whose tone marks it pending must also say so in words, because a
 *     dashed border and an amber wash are invisible in greyscale and to anyone
 *     who has not been told what they mean;
 *   - a lane's boundary sentence must be in the document unconditionally, since
 *     the whole reason two lanes are drawn apart is that they may not be read as
 *     one;
 *   - `CapabilityGrid` must have nowhere to put a proficiency rating.
 *
 * Layout is not tested here. jsdom has no layout engine, so the geometry claims
 * — first visual position, first-viewport counts — are asserted in Playwright and
 * measured by `scripts/measure-ux.ts`.
 */
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CapabilityGrid, StatRail, StatusGrid } from '@/components/ui/summary-grid'
import { FlowDiagram, LaneFlow } from '@/components/visuals/flow'

describe('FlowDiagram', () => {
  it('renders the stages as an ordered list in flow order', () => {
    render(
      <FlowDiagram
        label="A pipeline"
        stages={[{ label: 'First' }, { label: 'Second' }, { label: 'Third' }]}
      />
    )
    const list = screen.getByRole('list', { name: 'A pipeline' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items.map((item) => item.textContent)).toEqual(['First', 'Second', 'Third'])
  })

  it('states a non-default stage state in words, not only in colour', () => {
    render(
      <FlowDiagram
        label="A pipeline"
        stages={[
          { label: 'Reporting views' },
          {
            label: 'Semantic model',
            tone: 'pending',
            state: 'Engine validation pending',
          },
        ]}
      />
    )
    // The claim survives greyscale because it is text.
    expect(screen.getByText('Engine validation pending')).toBeInTheDocument()
  })

  it('hides the connectors from assistive technology', () => {
    const { container } = render(
      <FlowDiagram
        label="A pipeline"
        stages={[{ label: 'First' }, { label: 'Second' }]}
      />
    )
    // One connector for two stages, and it is decoration: the list is already
    // ordered, so "arrow" announced between every item is noise.
    const decorative = container.querySelectorAll('[aria-hidden="true"]')
    expect(decorative.length).toBe(1)
  })

  it('renders a caption as a figcaption when one is given', () => {
    const { container } = render(
      <FlowDiagram
        label="A pipeline"
        stages={[{ label: 'First' }]}
        caption="Nothing here runs at request time."
      />
    )
    const caption = container.querySelector('figcaption')
    expect(caption?.textContent).toBe('Nothing here runs at request time.')
  })
})

describe('LaneFlow', () => {
  const LANES = [
    {
      title: 'Synthetic warehouse',
      state: 'Machine-generated',
      stages: [{ label: 'Seeded generators' }],
      boundary: 'No row of it was ever observed anywhere.',
    },
    {
      title: 'Reference listings',
      state: 'Observed, then de-identified',
      stages: [{ label: 'Private workbook' }],
      boundary:
        'Calling this lane synthetic would claim more sanitization than was performed.',
      tone: 'pending' as const,
    },
  ]

  it('keeps every boundary sentence in the document without interaction', () => {
    render(<LaneFlow label="The two lanes" lanes={LANES} />)
    for (const lane of LANES) {
      expect(screen.getByText(lane.boundary)).toBeInTheDocument()
    }
    // And none of them is inside a disclosure. A caveat a reader has to open is
    // a caveat the page is hoping they will not read.
    expect(document.querySelector('details')).toBeNull()
  })

  it('names each lane and its provenance state in text', () => {
    render(<LaneFlow label="The two lanes" lanes={LANES} />)
    expect(screen.getByRole('heading', { name: 'Synthetic warehouse' })).toBeVisible()
    expect(screen.getByText('Observed, then de-identified')).toBeInTheDocument()
  })
})

describe('StatusGrid', () => {
  it('pairs every state with its own badge word', () => {
    render(
      <StatusGrid
        label="Controls"
        entries={[
          { label: 'Synthetic data only', status: 'complete' },
          { label: 'Gate 2', status: 'blocked', statusLabel: 'Closed' },
        ]}
      />
    )
    expect(screen.getByText('Complete')).toBeInTheDocument()
    expect(screen.getByText('Closed')).toBeInTheDocument()
  })

  it('drops the detail text in compact density but keeps the state', () => {
    render(
      <StatusGrid
        label="Controls"
        density="compact"
        entries={[
          { label: 'Reporting role confined', status: 'complete', detail: 'By test.' },
        ]}
      />
    )
    expect(screen.queryByText('By test.')).toBeNull()
    expect(screen.getByText('Complete')).toBeInTheDocument()
  })
})

describe('StatRail', () => {
  it('renders each figure as a definition of its label', () => {
    const { container } = render(
      <StatRail
        label="Four figures"
        stats={[
          { value: '28', label: 'Reporting views', note: 'Own the SQL side' },
          { value: '22', label: 'Governed KPIs' },
        ]}
      />
    )
    expect(container.querySelectorAll('dt')).toHaveLength(2)
    expect(screen.getByText('28')).toBeInTheDocument()
    expect(screen.getByText('Own the SQL side')).toBeInTheDocument()
  })
})

describe('CapabilityGrid', () => {
  it('links every capability to the artefact that evidences it', () => {
    render(
      <CapabilityGrid
        label="Capabilities"
        capabilities={[
          {
            name: 'SQL and PostgreSQL',
            evidence: 'Ordered, re-runnable build scripts.',
            path: 'sql/',
          },
        ]}
      />
    )
    // The trailing slash marks a directory and is dropped from the tree URL.
    const link = screen.getByRole('link', { name: /sql\// })
    expect(link.getAttribute('href')).toMatch(/\/tree\/main\/sql$/)
  })

  it('renders no percentage, meter or progress element', () => {
    const { container } = render(
      <CapabilityGrid
        label="Capabilities"
        capabilities={[
          {
            name: 'Python engineering',
            evidence: 'A typed generator suite.',
            path: 'src/arpi/',
          },
        ]}
      />
    )
    // The rule the About page argued for in prose is now structural: there is no
    // prop for a rating and no element that could render one.
    expect(container.querySelector('meter, progress')).toBeNull()
    expect(container.textContent).not.toMatch(/\d+\s?%/)
  })
})
