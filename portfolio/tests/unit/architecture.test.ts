/**
 * The architecture graph is the one piece of authored content whose geometry is
 * hand-placed, which makes it the one piece that can silently become wrong: a node
 * can be given a source path that no longer exists, an edge can point at a node
 * that was renamed, and a diagram will still render.
 *
 * So every claim the graph makes is checked here against the repository itself.
 *
 * Documented in portfolio/docs/CONTENT_MODEL.md section 8.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  ARCHITECTURE_EDGES,
  ARCHITECTURE_NODES,
  LAYER_LABEL,
  architectureNode,
  downstreamOf,
  flowDistances,
  upstreamOf,
  type NodeLayer,
} from '../../src/content/architecture.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')

const ids = new Set(ARCHITECTURE_NODES.map((node) => node.id))

/* -------------------------------------------------------------------------- */
/* Shape                                                                       */
/* -------------------------------------------------------------------------- */

describe('the graph is well-formed', () => {
  it('holds fourteen nodes and sixteen edges', () => {
    expect(ARCHITECTURE_NODES).toHaveLength(14)
    expect(ARCHITECTURE_EDGES).toHaveLength(16)
  })

  it('gives every node a unique id', () => {
    expect(ids.size).toBe(ARCHITECTURE_NODES.length)
  })

  it('gives every node a label, a summary and a detail', () => {
    for (const node of ARCHITECTURE_NODES) {
      expect(node.label.length, node.id).toBeGreaterThan(0)
      expect(node.summary.length, node.id).toBeGreaterThan(20)
      // Two or three sentences: what it does and what it deliberately does not.
      expect(node.detail.length, node.id).toBeGreaterThan(80)
    }
  })

  it('keeps every drawn label to two lines', () => {
    for (const node of ARCHITECTURE_NODES) {
      expect(node.shortLabel.length, node.id).toBeLessThanOrEqual(2)
      for (const line of node.shortLabel) {
        expect(line.length, `${node.id}: "${line}"`).toBeLessThanOrEqual(16)
      }
    }
  })

  it('assigns every node a layer that has a label', () => {
    for (const node of ARCHITECTURE_NODES) {
      expect(LAYER_LABEL[node.layer], node.id).toBeDefined()
    }
  })

  it('uses every declared layer at least once', () => {
    const used = new Set(ARCHITECTURE_NODES.map((node) => node.layer))
    const declared = Object.keys(LAYER_LABEL) as NodeLayer[]
    expect(declared.filter((layer) => !used.has(layer))).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* Geometry                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The explorer's drawing constants, read out of the component so the two cannot
 * disagree. Duplicating them here as literals would let the component change the
 * node size and the test keep passing against the old one.
 */
const explorer = readFileSync(
  resolve(HERE, '../../src/components/explorers/architecture-explorer.tsx'),
  'utf8'
)

function constant(name: string): number {
  const value = new RegExp(`const ${name} = (\\d+)`).exec(explorer)?.[1]
  expect(value, `${name} is not declared in the explorer`).toBeDefined()
  return Number(value)
}

const NODE_WIDTH = constant('NODE_WIDTH')
const NODE_HEIGHT = constant('NODE_HEIGHT')
const VIEW_WIDTH = constant('VIEW_WIDTH')
const VIEW_HEIGHT = constant('VIEW_HEIGHT')

/** The layer bands, parsed from the same file. */
const BANDS = [...explorer.matchAll(/\{ label: '(\w+)', x: (\d+), width: (\d+) \}/g)].map(
  (match) => ({
    label: match[1] ?? '',
    x: Number(match[2]),
    width: Number(match[3]),
  })
)

describe('every node is fully inside the drawing grid', () => {
  /**
   * The defect this exists for: two presentation nodes sat at x=960 with a node
   * width of 96 in a viewBox 1000 wide, so their right-hand 56 units were outside
   * the canvas. An SVG does not complain about content past its own edge, so the
   * nodes were simply cut in half and nothing in the pipeline noticed.
   */
  it('keeps every node box within the viewBox on both axes', () => {
    const escaping: string[] = []
    for (const node of ARCHITECTURE_NODES) {
      if (node.x < 0 || node.x + NODE_WIDTH > VIEW_WIDTH) {
        escaping.push(`${node.id}: x ${String(node.x)}-${String(node.x + NODE_WIDTH)}`)
      }
      if (node.y < 0 || node.y + NODE_HEIGHT > VIEW_HEIGHT) {
        escaping.push(`${node.id}: y ${String(node.y)}-${String(node.y + NODE_HEIGHT)}`)
      }
    }
    expect(escaping).toEqual([])
  })

  it('keeps every node above the band label strip', () => {
    // The band labels are drawn at VIEW_HEIGHT - 14, and the bands themselves end
    // at VIEW_HEIGHT - 32. A node overlapping either is unreadable.
    const bandBottom = VIEW_HEIGHT - 32
    for (const node of ARCHITECTURE_NODES) {
      expect(node.y + NODE_HEIGHT, node.id).toBeLessThanOrEqual(bandBottom)
    }
  })

  it('places no two node boxes so that they overlap', () => {
    // Compared at the real node dimensions rather than an eyeballed margin. Two
    // pairs failed this: desktop-validation against report-pages, and case-study
    // against fabric-validation, each by 21x14 units.
    const overlapping: string[] = []
    for (const a of ARCHITECTURE_NODES) {
      for (const b of ARCHITECTURE_NODES) {
        if (a.id >= b.id) continue
        const dx = Math.abs(a.x - b.x)
        const dy = Math.abs(a.y - b.y)
        if (dx < NODE_WIDTH && dy < NODE_HEIGHT) {
          overlapping.push(`${a.id} / ${b.id} (dx ${String(dx)}, dy ${String(dy)})`)
        }
      }
    }
    expect(overlapping).toEqual([])
  })

  it('leaves a readable gap between every pair of boxes', () => {
    // Not overlapping is the floor; touching is still unreadable. 12 units on
    // either axis is roughly the corner radius plus a hairline.
    const tight: string[] = []
    for (const a of ARCHITECTURE_NODES) {
      for (const b of ARCHITECTURE_NODES) {
        if (a.id >= b.id) continue
        const gapX = Math.abs(a.x - b.x) - NODE_WIDTH
        const gapY = Math.abs(a.y - b.y) - NODE_HEIGHT
        if (Math.max(gapX, gapY) < 12) tight.push(`${a.id} / ${b.id}`)
      }
    }
    expect(tight).toEqual([])
  })
})

describe('the layer bands actually group the nodes they claim to', () => {
  /**
   * The bands are described in the component as "a faint grouping cue". A cue that
   * contains half its group is worse than no cue: it draws a boundary in the wrong
   * place. The first version's ranges predated the node coordinates.
   */
  const BAND_FOR_LAYER: Record<NodeLayer, string> = {
    configuration: 'GENERATE',
    generation: 'GENERATE',
    validation: 'GENERATE',
    database: 'PERSIST',
    semantic: 'MODEL',
    presentation: 'PRESENT',
  }

  it('parses all four bands out of the component', () => {
    expect(BANDS.map((band) => band.label)).toEqual([
      'GENERATE',
      'PERSIST',
      'MODEL',
      'PRESENT',
    ])
  })

  it('contains every node inside the band for its layer', () => {
    const outside: string[] = []
    for (const node of ARCHITECTURE_NODES) {
      const label = BAND_FOR_LAYER[node.layer]
      const band = BANDS.find((candidate) => candidate.label === label)
      expect(band, `no band labelled ${label}`).toBeDefined()
      if (!band) continue
      if (node.x < band.x || node.x + NODE_WIDTH > band.x + band.width) {
        outside.push(
          `${node.id} (${String(node.x)}-${String(node.x + NODE_WIDTH)}) is not inside ${label} (${String(band.x)}-${String(band.x + band.width)})`
        )
      }
    }
    expect(outside).toEqual([])
  })

  it('draws the bands left to right without overlapping each other', () => {
    for (let index = 1; index < BANDS.length; index += 1) {
      const previous = BANDS[index - 1]
      const current = BANDS[index]
      if (!previous || !current) continue
      expect(current.x, `${current.label} overlaps ${previous.label}`).toBeGreaterThan(
        previous.x + previous.width
      )
    }
  })

  it('keeps the last band inside the viewBox', () => {
    const last = BANDS.at(-1)
    expect(last).toBeDefined()
    if (last) expect(last.x + last.width).toBeLessThanOrEqual(VIEW_WIDTH)
  })
})

/* -------------------------------------------------------------------------- */
/* Edges                                                                       */
/* -------------------------------------------------------------------------- */

describe('every edge connects two real nodes', () => {
  it('references no unknown id', () => {
    const unknown: string[] = []
    for (const edge of ARCHITECTURE_EDGES) {
      if (!ids.has(edge.from)) unknown.push(`from ${edge.from}`)
      if (!ids.has(edge.to)) unknown.push(`to ${edge.to}`)
    }
    expect(unknown).toEqual([])
  })

  it('declares no self-edge and no duplicate', () => {
    const seen = new Set<string>()
    for (const edge of ARCHITECTURE_EDGES) {
      expect(edge.from, 'self-edge').not.toBe(edge.to)
      const key = `${edge.from}->${edge.to}`
      expect(seen.has(key), `duplicate ${key}`).toBe(false)
      seen.add(key)
    }
  })

  it('leaves no node unconnected', () => {
    const connected = new Set(ARCHITECTURE_EDGES.flatMap((edge) => [edge.from, edge.to]))
    expect([...ids].filter((id) => !connected.has(id))).toEqual([])
  })

  it('flows left to right, because the layout is the information', () => {
    // Left-to-right is direction of travel. An edge running backwards would make
    // the diagram lie about the pipeline.
    const backwards = ARCHITECTURE_EDGES.filter(
      (edge) => architectureNode(edge.to).x < architectureNode(edge.from).x
    ).map((edge) => `${edge.from} -> ${edge.to}`)
    expect(backwards).toEqual([])
  })

  it('contains no cycle', () => {
    // Asserted rather than assumed: `upstreamOf` and `downstreamOf` walk the graph,
    // and a cycle would make them loop rather than return.
    for (const id of ids) {
      expect(upstreamOf(id).has(id), `${id} is upstream of itself`).toBe(false)
      expect(downstreamOf(id).has(id), `${id} is downstream of itself`).toBe(false)
    }
  })

  it('marks a planned edge only where it leads to work that has not started', () => {
    const planned = ARCHITECTURE_EDGES.filter((edge) => edge.kind === 'planned')
    expect(planned.length).toBeGreaterThan(0)
    for (const edge of planned) {
      const target = architectureNode(edge.to)
      // A planned path must not arrive at something described as built. The two
      // presentation nodes read their status from the manifest, which is `null`
      // here; the rest must not be `complete`.
      expect(target.status, `${edge.from} -> ${edge.to}`).not.toBe('complete')
    }
  })
})

describe('upstream and downstream are consistent', () => {
  it('makes each the inverse of the other', () => {
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue
        expect(
          upstreamOf(b).has(a),
          `${a} downstream of ${b} disagrees with ${b} upstream of ${a}`
        ).toBe(downstreamOf(a).has(b))
      }
    }
  })

  it('gives the leftmost node no upstream', () => {
    const leftmost = [...ARCHITECTURE_NODES].sort((a, b) => a.x - b.x)[0]
    expect(leftmost).toBeDefined()
    if (leftmost) expect([...upstreamOf(leftmost.id)]).toEqual([])
  })

  it('has exactly one source and reaches every node from it', () => {
    // One entry point is a property of this pipeline: configuration is the only
    // thing nothing else produces. If a second source appeared, the diagram would
    // be describing two pipelines drawn on one canvas.
    const withIncoming = new Set(ARCHITECTURE_EDGES.map((edge) => edge.to))
    const sources = [...ids].filter((id) => !withIncoming.has(id))
    expect(sources).toHaveLength(1)
    const [source] = sources
    expect(source).toBeDefined()
    if (source !== undefined) {
      expect(downstreamOf(source).size).toBe(ids.size - 1)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Claims about the repository                                                 */
/* -------------------------------------------------------------------------- */

describe('every path a node points at exists', () => {
  it('resolves every sourcePaths entry', () => {
    const missing: string[] = []
    for (const node of ARCHITECTURE_NODES) {
      expect(node.sourcePaths.length, `${node.id} cites nothing`).toBeGreaterThan(0)
      for (const path of node.sourcePaths) {
        if (!existsSync(join(REPO, path))) missing.push(`${node.id}: ${path}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('resolves every docPaths entry', () => {
    const missing: string[] = []
    for (const node of ARCHITECTURE_NODES) {
      for (const path of node.docPaths) {
        if (!existsSync(join(REPO, path))) missing.push(`${node.id}: ${path}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('cites a repository-relative path, never an absolute or escaping one', () => {
    for (const node of ARCHITECTURE_NODES) {
      for (const path of [...node.sourcePaths, ...node.docPaths]) {
        expect(path.startsWith('/'), `${node.id}: ${path}`).toBe(false)
        expect(path.includes('..'), `${node.id}: ${path}`).toBe(false)
      }
    }
  })
})

describe('the privacy boundary is stated on every node, not once in a footer', () => {
  it('states it', () => {
    for (const node of ARCHITECTURE_NODES) {
      expect(node.privacyBoundary.length, node.id).toBeGreaterThan(10)
    }
  })

  it('states it as a sentence, not a keyword', () => {
    for (const node of ARCHITECTURE_NODES) {
      expect(node.privacyBoundary.length, node.id).toBeGreaterThan(40)
      expect(node.privacyBoundary.trim().endsWith('.'), node.id).toBe(true)
    }
  })

  it('never claims a node handles real, personal or production data', () => {
    // The one thing a privacy boundary must not say. Every node in this project
    // handles synthetic data only; if one ever did not, that would have to be
    // argued here rather than slipped into a description.
    for (const node of ARCHITECTURE_NODES) {
      expect(node.privacyBoundary, node.id).not.toMatch(
        /\breal (customer|dealership|lending|production) data\b/i
      )
      expect(node.privacyBoundary, node.id).not.toMatch(
        /\banonymis|\bde-identif|\bpseudonym/i
      )
    }
  })

  it('states role access on every node', () => {
    for (const node of ARCHITECTURE_NODES) {
      expect(node.roleAccess.length, node.id).toBeGreaterThan(0)
    }
  })
})

describe('no node claims a status the manifest owns', () => {
  it('leaves the semantic model and the presentation nodes to the manifest', () => {
    // A `status` of null means "read it from the manifest at render time", which is
    // how the parts that can drift stay generated rather than authored.
    const deferred = ARCHITECTURE_NODES.filter((node) => node.status === null)
    expect(deferred.length).toBeGreaterThanOrEqual(3)
    for (const node of deferred) {
      expect(['semantic', 'presentation']).toContain(node.layer)
    }
  })

  it('never hardcodes complete for a semantic or presentation node', () => {
    const overclaimed = ARCHITECTURE_NODES.filter(
      (node) =>
        (node.layer === 'semantic' || node.layer === 'presentation') &&
        node.status === 'complete'
    ).map((node) => node.id)
    expect(overclaimed).toEqual([])
  })
})

describe('architectureNode', () => {
  it('returns the node', () => {
    const first = ARCHITECTURE_NODES[0]
    expect(first).toBeDefined()
    if (first) expect(architectureNode(first.id).label).toBe(first.label)
  })

  it('throws on an unknown id rather than returning undefined', () => {
    // The explorer indexes into this from a selection, and a silent undefined
    // would render an empty panel instead of failing the build.
    expect(() => architectureNode('not-a-node')).toThrow()
  })
})

/* -------------------------------------------------------------------------- */
/* Flow distances                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The hop counts the explorer's selection wave is ordered by.
 *
 * These are not decoration even though the thing they drive is: an edge given
 * the wrong hop count draws at the wrong moment, and the animation then says the
 * data flows in an order it does not. The property worth asserting is that these
 * are SHORTEST paths, because the graph has more than one route between some
 * pairs and a depth-first walk would record whichever it happened to take.
 */
describe('flowDistances', () => {
  it('puts the selected node at zero in both directions', () => {
    const { upstream, downstream } = flowDistances('warehouse')
    expect(upstream.get('warehouse')).toBe(0)
    expect(downstream.get('warehouse')).toBe(0)
  })

  it('agrees with the set helpers about who is on the path', () => {
    for (const node of ARCHITECTURE_NODES) {
      const { upstream, downstream } = flowDistances(node.id)
      const ups = new Set([...upstream.keys()].filter((id) => id !== node.id))
      const downs = new Set([...downstream.keys()].filter((id) => id !== node.id))
      expect(ups, `${node.id} upstream`).toEqual(upstreamOf(node.id))
      expect(downs, `${node.id} downstream`).toEqual(downstreamOf(node.id))
    }
  })

  it('counts the shortest route, not the first one found', () => {
    // `validation` reaches `reporting` two ways: through `csv`, `raw`,
    // `staging` and `warehouse`, and directly through `audit`. The shorter one
    // is two hops, and a depth-first walk would have recorded five.
    const { downstream } = flowDistances('validation')
    expect(downstream.get('audit')).toBe(1)
    expect(downstream.get('reporting')).toBe(2)
  })

  it('counts one hop per edge along the spine', () => {
    const { upstream } = flowDistances('reporting')
    expect(upstream.get('warehouse')).toBe(1)
    expect(upstream.get('staging')).toBe(2)
    expect(upstream.get('raw')).toBe(3)
    expect(upstream.get('csv')).toBe(4)
  })

  it('gives an entry point no upstream and a terminal node no downstream', () => {
    expect([...flowDistances('config').upstream.keys()]).toEqual(['config'])
    expect([...flowDistances('case-study').downstream.keys()]).toEqual(['case-study'])
  })

  it('never reports a distance for a node that is not connected', () => {
    for (const node of ARCHITECTURE_NODES) {
      const { upstream, downstream } = flowDistances(node.id)
      for (const map of [upstream, downstream]) {
        for (const [id, hops] of map) {
          expect(ids.has(id), `${id} is not a node`).toBe(true)
          expect(hops).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })
})
