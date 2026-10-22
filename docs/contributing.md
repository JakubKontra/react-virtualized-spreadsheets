# Contributing

Contributions should improve a specific workflow while preserving the headless core, bounded rendering and correct calculations over complete data. For substantial API changes, discuss the problem and proposed contract before implementing a broad redesign.

## Development setup

Use Node.js 22.13+ and pnpm 10. From the repository root:

```bash
pnpm install
pnpm dev
```

The demo runs on port 5173 and its reference API on 4317. `pnpm dev:ui-example` runs the independent UI consumer on 5174 after the packages have been built. `pnpm dev:docs` starts this documentation on 3000 and builds its local examples first.

## Repository map

| Location                          | Purpose                                                     |
| --------------------------------- | ----------------------------------------------------------- |
| `packages/core`                   | Formula engine, store, view mapping, cache and transactions |
| `packages/react`                  | Virtual viewport, hooks, keyboard and pointer interactions  |
| `packages/ui`                     | Optional shadcn/ui renderer and scoped styles               |
| `packages/transport`              | Worker/HTTP adapters and persistence                        |
| `apps/demo`, `apps/server`        | Sales demo and reference calculation service                |
| `apps/ui-example`                 | Independent consumer using built package exports            |
| `apps/docs`, `apps/docs-examples` | Docusaurus site and isolated interactive examples           |
| `docs`                            | Canonical documentation content                             |
| `tests`, `benchmarks`             | Unit, integration, browser and performance checks           |

## Report a bug

Use the bug report template in the repository issue tracker. Include the package/commit, browser, local or remote mode, smallest dataset/formula that reproduces the issue, exact steps, expected result and actual result. Include a trace or screenshot when it helps; remove private data and credentials.

For calculation problems, show the literal input and expected value. For layout problems, include viewport size, zoom, frozen panes and any active filters. For performance problems, include dataset dimensions, formula shape, hardware and production/development mode.

## Propose a feature

Use the feature request template. Describe the user's task, a concrete before/after example and how success can be verified. Mention whether the behavior belongs to the engine, React hooks, optional UI or an adapter. Check the [roadmap](roadmap.md) and existing issues before starting.

## Make a focused change

Keep each change scoped to one behavior. Preserve source identities, revision guards and bounded caches. Do not materialize a million-row matrix in React to implement a toolbar feature. Avoid coupling `@sheet/core` to browser globals or UI libraries. The host should continue to own stores, adapters and persistence.

Add meaningful regression coverage for changed behavior and update the relevant documentation. Small prose or visual changes do not need tests that merely mirror their implementation. Describe any known limitations in the pull request.

## Run checks

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

Choose the additional check that covers your change:

| Change                                       | Additional validation                            |
| -------------------------------------------- | ------------------------------------------------ |
| Keyboard, pointer, view or renderer behavior | `pnpm test:e2e`                                  |
| Package exports, UI CSS or packaging         | `pnpm test:ui-package`                           |
| Calculation or large-grid performance        | `pnpm benchmark` and/or `pnpm benchmark:browser` |
| Documentation or live examples               | `pnpm test:docs`                                 |

Browser checks need Playwright Chromium: run `pnpm exec playwright install chromium` if it is not installed. Performance results must include environment and workload; do not turn a single run into a universal guarantee.

## Work on documentation

Write pages in `docs/` and register them in `apps/docs/sidebars.ts`. The four existing guides are reused directly. Interactive examples live in `apps/docs-examples/src`; MDX pages import their source instead of maintaining duplicate snippets. After changing examples, restart `pnpm dev:docs` or rerun `pnpm prepare:docs` and restart the documentation server.

`pnpm build:docs` typechecks the site and builds static output in `apps/docs/build`. Broken links fail the build. Local search is indexed during the production build; use `pnpm serve:docs` to verify it. `pnpm test:docs` tests that production output without the demo API.

To check hosting below a subpath:

```bash
DOCS_BASE_URL=/spreadsheet/ pnpm test:docs
```

Set `DOCS_URL` to the deployment origin and `DOCS_BASE_URL` to its path before building. Optional `DOCS_REPOSITORY_URL` adds repository/edit links; `DOCS_REPOSITORY_BRANCH` defaults to `main`. Without a repository URL, those links are hidden. These commands generate static files; they do not publish a website. Rebuild without the environment variables to return to root-path local serving.

The `Documentation` GitHub Actions workflow publishes `main` to GitHub Pages. The `Checks` workflow validates pushes and pull requests. Releases are published separately: update all four package versions and the changelog, run the relevant checks, and use `pnpm pack:release` to produce the package archives and `SHA256SUMS` under `artifacts/v<version>`. Mark beta releases as GitHub prereleases; packaging does not publish to npm.

## Pull requests

Use a concise title such as `fix(core): preserve references after a column move`. Explain the trigger, resulting behavior, important tradeoffs and checks run. Keep tests with the behavior they cover. Include screenshots for visible UI changes and note any checks you could not run. Open a draft when feedback is needed before the change is ready.

The project is licensed under the [MIT License](https://github.com/jakubkontra/react-virtualized-spreadsheets/blob/main/LICENSE). Preserve the existing license and third-party notices when modifying or redistributing code. The UI package includes separate notices for its bundled component sources.

## Support the project

You can also [support development on Ko-fi](https://ko-fi.com/jakubkontra). Bug reports, documentation improvements and focused code contributions are welcome too.
