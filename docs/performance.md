# Performance methodology

Virtualization bounds rendered DOM, not formula cost or source-data memory. Ledger separately bounds client blocks and formula-result caches and runs calculations off the main UI thread.

## Reproduce

```sh
pnpm benchmark
pnpm exec playwright install chromium
pnpm benchmark:browser
```

Raw results include timestamp, machine/runtime information, fixture dimensions and timings. They are written to `benchmark-results/engine.json` and `benchmark-results/browser.json`.

## Recorded reference run

2026-10-22, Apple M4 Max, macOS, Node 22.13.1, Chromium 156.0.8078.4. Browser measurements use the development build and a warm local dev server, with persistent views, the new feature controls and selection summaries enabled. This timing run uses no active query or frozen panes; those interactions have separate browser correctness checks.

| Measurement                                         | Result                              |
| --------------------------------------------------- | ----------------------------------- |
| First local data visible                            | 430 ms                              |
| Local edit to next frame, p95                       | 51.8 ms                             |
| Mounted data cells, initial / maximum during scroll | 242 / 330                           |
| Client cache after scrolling                        | 48 blocks / 24,576 cells            |
| Frame interval, p95 during large scroll jumps       | 54.4 ms                             |
| Server mode at `AX1000000`                          | 276 mounted cells / 5 cached blocks |
| Engine `SUM` over 100,000 numeric source cells      | 14.2 ms                             |
| Engine `SUM` over 1,000,000 numeric source cells    | 113.8 ms                            |

The edit target passed on this machine. Large scroll jumps did not consistently maintain a 16.7 ms frame budget; the measurement does not claim universal 60 fps. Re-run on target hardware and production-shaped data before setting a product performance budget.

The engine benchmark exercises 100,000 × 50 and 1,000,000 × 50 logical grids with six generated source columns, two calculated columns and the remaining columns blank. It measures initialization, a 64 × 16 block, one `SUM` across all source rows, and 100 single-source edits followed by a dependent formula read. The data generator avoids allocating a dense matrix. This is not evidence that fifty million populated string cells fit in browser memory.

The browser benchmark runs headless Chromium at 1440 × 1000 against Vite's development server. It records navigation-to-first-data time, 40 local edit-to-next-frame samples, frame intervals during 120 large scroll jumps, DOM cell count, client cache size and the available Chromium heap estimate. It then navigates to `AX1000000` in server mode. It asserts local edit p95 below 100 ms, fewer than 600 mounted data cells for this viewport, and no more than 48 cached blocks. These thresholds are reference-machine checks, not a hardware-independent service guarantee.

## shadcn renderer comparison

2026-10-22, same machine, Chromium and viewport as above. Before/after runs use the existing browser benchmark with no active queries or pinned panes. These are individual development-build runs, not repeated statistical trials.

| Measurement                                | Previous demo renderer | `@sheet/ui` renderer |
| ------------------------------------------ | ---------------------- | -------------------- |
| First local data                           | 322 ms                 | 362 ms               |
| Local edit to next frame, p95              | 52.7 ms                | 62.4 ms              |
| Large scroll-jump frame interval, p95      | 31.5 ms                | 47.5 ms              |
| Mounted cells, initial / maximum on scroll | 242 / 330              | 242 / 330            |
| Cache after scrolling                      | 48 blocks              | 48 blocks            |
| Million-row source at `AX1000000`          | 276 cells / 5 blocks   | 276 cells / 5 blocks |

The UI integration preserves the DOM/cache bounds and passes the existing edit-latency target; these runs show higher edit and scroll latency than the former renderer. Settings are deferred to a separate chunk, toolbar controls skip viewport-only renders, and virtual cells do not mount tooltip or menu providers. There is no claim of 60 fps during large jumps. Both frontend builds currently produce an initial JavaScript chunk around 537–541 kB (about 170–172 kB gzip); Vite reports its default 500 kB chunk-size advisory. Measure the production app on target devices before setting stricter budgets.

## Boundaries

- Frozen panes use disjoint viewport rectangles and remain within the same cache budget. The browser test pins both axes, jumps to row 90,000, and checks bounded mounted cells.
- Queries retain packed row indices plus an inverse index (about 8 MB for a million results) in the browser; source values remain in the worker/server. Stable sort temporarily allocates key arrays in the calculation worker. The registry caches up to eight views, each with at most one query projection.
- Selection summaries aggregate the entire selected query result, not just cached cells. Broad searches and formula-heavy selections can take longer than direct edits.
- Client cache: 48 blocks × 64 rows × 8 columns by default. The initial viewport requires only a handful of blocks. Requests are deduplicated, superseded viewport requests are aborted, and responses are guarded by generation/revision.
- Formula cache: 10,000 values, 2,048 parsed expressions. Templates are shifted and evaluated lazily rather than materializing a formula object for every row.
- Single source block: at most 20,000 cells. Clipboard/edit transactions: at most 10,000 cells.
- `SUM` of a numeric source column scans that range. A sum of a million distinct formula results is substantially more expensive and has not been promised to fit the 100 ms edit target.
- An in-progress synchronous calculation in a worker is not preempted by canceling a client request. Cancellation discards the result; disposal terminates the browser worker. Long calculations can queue later worker requests while the UI remains responsive.
- View order and hidden items use compact intervals. The browser interaction test moves the final record of the million-row source, checks fewer than 600 mounted cells, and checks that the saved definition stays below 8 KB. View input overrides and fragmented orders grow with user edits, not source row count.
- Selection and drafts live outside mounted cell DOM. Cell subscriptions avoid notifying unrelated unchanged primitive cells when a block refreshes.
- Native scroll dimensions limit the largest sheet. The demonstration's million rows × 32 px fits Chromium's scroll extent at normal zoom. Other browsers and larger logical dimensions require separate verification or a segmented scroll implementation.
- Node/Chromium heap estimates exclude some native and worker memory. Results must be interpreted with that limitation.

For Cartop production data, benchmark the actual record types, formula graph, source update frequency and database latency. Keep authoritative aggregation on the server; progressive row loading must never change a formula's meaning.
