import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';

const packages = [
  [
    '@sheet/core',
    'The calculation & state layer',
    'Formula evaluation, bounded block caching, selection, history and persistent view definitions.',
  ],
  [
    '@sheet/react',
    'Your interface, your components',
    'Two-axis virtualization and unstyled interaction props. Bring your own React design system.',
  ],
  [
    '@sheet/ui',
    'A ready-to-use spreadsheet',
    'An optional shadcn/ui renderer with editing, formula help, menus, formatting and frozen panes.',
  ],
  [
    '@sheet/transport',
    'Choose where data lives',
    'Local workers, HTTP/SSE sources and view persistence, behind explicit adapter contracts.',
  ],
];
export default function Home() {
  return (
    <Layout
      title="React spreadsheets, on your terms"
      description="Build virtualized spreadsheets in React with formulas, a headless API and an optional shadcn/ui renderer. Guides, live examples and integration recipes."
    >
      <main>
        <section className="docs-hero container">
          <div className="hero-copy">
            <span className="eyebrow">
              <span className="status-dot" /> HEADLESS REACT · TYPESCRIPT · SHADCN/UI
            </span>
            <h1>
              A spreadsheet.
              <br />
              <span>Part of your app.</span>
            </h1>
            <p className="hero-description">
              Give your data a place to work. Add formulas, familiar editing and a virtualized
              grid—with full control over the interface and data source.
            </p>
            <div className="hero-actions">
              <Link
                className="button button--primary button--lg"
                to="/docs/getting-started/installation"
              >
                Start building <span aria-hidden="true">↗</span>
              </Link>
              <Link className="button button--secondary button--lg" to="/docs/examples/basic">
                Try the examples
              </Link>
            </div>
            <p className="hero-note">
              Workspace packages · Early development · React 18+ headless / 19+ UI
            </p>
          </div>
          <div
            className="sheet-illustration"
            aria-label="Example quotation: formulas update calculated totals"
          >
            <div className="illustration-title">
              <span className="mini-grid" aria-hidden="true">
                ▦
              </span>{' '}
              Project estimate <span className="illustration-badge">LOCAL</span>
            </div>
            <div className="illustration-formula">
              <span>E2</span>
              <span>ƒx</span>
              <code>=B2*C2*(1-D2)</code>
            </div>
            <div className="illustration-table">
              <table>
                <thead>
                  <tr>
                    <th aria-label="Row" />
                    <th>Service</th>
                    <th>Hours</th>
                    <th>Rate</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th>1</th>
                    <td>Design</td>
                    <td>12</td>
                    <td>€85</td>
                    <td>€1,020</td>
                  </tr>
                  <tr>
                    <th>2</th>
                    <td>Development</td>
                    <td>24</td>
                    <td>€110</td>
                    <td className="selected-value">
                      €2,376
                      <span />
                    </td>
                  </tr>
                  <tr>
                    <th>3</th>
                    <td>Review</td>
                    <td>4</td>
                    <td>€85</td>
                    <td>€340</td>
                  </tr>
                  <tr className="total-row">
                    <th>4</th>
                    <td>Total</td>
                    <td />
                    <td />
                    <td>€3,736</td>
                  </tr>
                  <tr aria-hidden="true">
                    <th>5</th>
                    <td />
                    <td />
                    <td />
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="illustration-footer">
              <span className="status-dot" /> Calculations stay with your data <span>Σ 3,736</span>
            </div>
            <Link className="illustration-link" to="/docs/examples/quotation">
              Open the working example <span aria-hidden="true">→</span>
            </Link>
          </div>
        </section>
        <section className="architecture-section">
          <div className="container">
            <div className="section-intro">
              <div>
                <span className="eyebrow">COMPOSE WHAT YOU NEED</span>
                <h2>Four packages. One spreadsheet.</h2>
              </div>
              <p>
                Start with the renderer or build from the hooks. Keep ownership of your data, store
                lifecycle and application styling.
              </p>
            </div>
            <div className="package-grid">
              {packages.map(([name, title, text], index) => (
                <Link
                  className="package-card"
                  key={name}
                  to={
                    [
                      '/docs/api/store',
                      '/docs/guides/headless',
                      '/docs/ui',
                      '/docs/guides/data-sources',
                    ][index]
                  }
                >
                  <code>{name}</code>
                  <h3>{title}</h3>
                  <p>{text}</p>
                  <span aria-hidden="true">↗</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
        <section className="container recipes-section">
          <div className="section-intro">
            <div>
              <span className="eyebrow">FROM DATA TO WORKFLOW</span>
              <h2>Make it useful.</h2>
            </div>
            <p>
              Working examples and integration recipes for the things your users actually need to
              do.
            </p>
          </div>
          <div className="recipe-grid">
            {[
              [
                '01',
                'Track inventory',
                'Typed columns, stock filters and conditional formatting.',
                '/docs/use-cases/inventory',
              ],
              [
                '02',
                'Calculate a quotation',
                'Quantities, discounts and totals that react to edits.',
                '/docs/use-cases/quotation',
              ],
              [
                '03',
                'Explore server data',
                'Authoritative calculations over records outside the browser.',
                '/docs/use-cases/server-reporting',
              ],
            ].map(([number, title, description, to]) => (
              <Link key={number} to={to} className="recipe-card">
                <span className="recipe-number">{number}</span>
                <h3>{title}</h3>
                <p>{description}</p>
                <span aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        </section>
        <section className="container project-section">
          <div>
            <span className="eyebrow">BUILT IN THE OPEN</span>
            <h2>Help shape the next release.</h2>
            <p>
              Stability and integrations come first. Follow the roadmap, report a reproducible issue
              or contribute a focused improvement.
            </p>
          </div>
          <div className="hero-actions">
            <Link className="button button--secondary" to="/docs/roadmap">
              Read the roadmap
            </Link>
            <Link className="button button--primary" to="/docs/contributing">
              Contribute
            </Link>
          </div>
        </section>
      </main>
    </Layout>
  );
}
