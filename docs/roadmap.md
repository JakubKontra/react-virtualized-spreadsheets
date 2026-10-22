# Roadmap

The current priority is **stability and integrations**. This is a direction for discussion, not a release schedule. No dates or compatibility promises are attached to unfinished work.

## Available today

- Headless React hooks and an optional shadcn/ui renderer.
- Two-axis virtualization, bounded block caching, local workers and HTTP/SSE sources.
- Editing, selection, undo/redo, clipboard modes, autofill and formula assistance.
- A documented formula subset with relative and absolute references.
- View-only row/column moves, insertion, hiding, custom-item removal and resizing.
- Frozen panes, sort/filter/search, typed columns, conditional formatting and selection summaries.
- Named-view persistence adapters and independent spreadsheet instances.
- Integration guides, local interactive examples and browser/performance checks.
- Public GitHub beta release with package archives and a deployed documentation site.

These capabilities have explicit limits. Read [performance](performance.md) and [formulas](formulas.md) before relying on Excel parity or a particular dataset size.

## Next: strengthen the foundations

| Area                    | What completion should mean                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| API stability           | Review public contracts, coordinate semantics and error behavior; document a versioning and migration policy      |
| Integration reliability | More adapter contract coverage, clearer stale-write recovery and examples for application-owned data              |
| Performance             | Reproducible production benchmarks, bundle reduction and budgets on representative devices                        |
| Accessibility           | Keyboard and screen-reader audits; visible focus and assistive-technology fixes based on findings                 |
| Browser support         | Explicitly tested Chromium, Firefox and WebKit behavior, including large scroll extents and clipboard differences |
| Release readiness       | Stable release process, migration policy and a public npm installation path                                       |

The existence of an ARIA grid or a successful Chromium test is not a completed accessibility or cross-browser audit.

## Later: spreadsheet capabilities

- CSV import/export with explicit parsing, typing and large-file behavior.
- XLSX interoperability, with documented treatment of unsupported formulas and formatting.
- Workbook-level sheet management and cross-sheet references.
- More formula functions with tested coercion, error and reference semantics.
- Richer data validation, cell-level rules and application validation hooks.

Current typed-column checks are available today; the richer validation system above is not.

## Exploring

Collaborative editing, presence and durable change history need a separate design for identity, concurrency, permissions and persistence. They are ideas under consideration, not existing APIs. Current undo/redo is local session history, and SSE updates are not multi-user collaboration.

## Propose a change

Start with the workflow and a concrete example. Describe the smallest useful behavior, how it interacts with both data modes, and how it can be tested without breaking virtualization or formula semantics. See the [contribution guide](contributing.md).
