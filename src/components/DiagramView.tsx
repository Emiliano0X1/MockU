import type { SystemDesignGraph } from '../api/types'

// Display order and names for the component types the backend allows.
const typeNames: Record<string, string> = {
  client: 'Client',
  cdn: 'CDN',
  load_balancer: 'Load balancer',
  api_service: 'Service',
  cache: 'Cache',
  queue: 'Queue',
  worker: 'Worker',
  database: 'Database',
  object_storage: 'Storage',
}
const typeOrder = Object.keys(typeNames)

// The architecture Mocky drew from the candidate's explanation: components
// (in request-flow order) and the connections between them.
export function DiagramView({ graph }: { graph: SystemDesignGraph }) {
  const labelOf = new Map(graph.nodes.map((n) => [n.id, n.label]))
  const nodes = [...graph.nodes].sort((a, b) => rank(a.type) - rank(b.type))

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="stack" style={{ gap: 8 }}>
        <h3 className="eyebrow">Components · {graph.nodes.length}</h3>
        {nodes.length === 0 && <p className="small">Mocky couldn't find any components in your explanation.</p>}
        {nodes.map((node) => (
          <div key={node.id} className="diagram-node">
            <span className="diagram-type">{typeNames[node.type] ?? node.type.replace(/_/g, ' ')}</span>
            <span className="stack" style={{ gap: 2, minWidth: 0 }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{node.label}</span>
              {node.description && <span className="small">{node.description}</span>}
            </span>
          </div>
        ))}
      </section>

      {graph.edges.length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <h3 className="eyebrow">Connections · {graph.edges.length}</h3>
          {graph.edges.map((edge) => (
            <div key={edge.id} className="diagram-edge">
              <span style={{ fontWeight: 700, fontSize: 14 }}>
                {labelOf.get(edge.source) ?? edge.source} <span style={{ color: 'var(--aurora)' }}>→</span> {labelOf.get(edge.target) ?? edge.target}
              </span>
              {(edge.label || edge.protocol) && (
                <span className="small">
                  {edge.label}
                  {edge.label && edge.protocol ? ' · ' : ''}
                  {edge.protocol}
                </span>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

function rank(type: string) {
  const i = typeOrder.indexOf(type)
  return i === -1 ? typeOrder.length : i
}
