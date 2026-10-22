# Installation

Use Node.js **22.13+** and pnpm **10** in this repository.

## Run the project

```bash
pnpm install
pnpm dev
```

Open `http://127.0.0.1:5173`. This starts the sales demonstration and its API on port `4317`. The local workbook has 100,000 rows; the remote workbook demonstrates one million rows. These are generated fixtures, not a connection to a production system.

For the documentation and its self-contained examples:

```bash
pnpm dev:docs
```

Open `http://127.0.0.1:3000`. No demo API is required. This command builds the workspace packages and live examples before starting Docusaurus. Documentation edits reload automatically; restart the command after changing example or package source.

## Consume from this workspace

In a new workspace app, declare the packages you use:

```json
{
  "dependencies": {
    "@sheet/core": "workspace:*",
    "@sheet/react": "workspace:*",
    "@sheet/transport": "workspace:*",
    "@sheet/ui": "workspace:*",
    "react": "^19.3.1",
    "react-dom": "^19.3.1"
  }
}
```

Run `pnpm install`, then build package exports before starting a consumer:

```bash
pnpm -r --filter './packages/**' build
```

For headless use, omit `@sheet/ui`. No component library or stylesheet is required by `@sheet/react`. For the renderer, configure the Tailwind 4 integration for your bundler and import these styles:

```css
@import 'tailwindcss';
@import '@sheet/ui/styles.css';
```

The [UI guide](../ui.md) includes the Vite configuration and theme details. `apps/ui-example` is a complete consumer of the built package exports.

## Consume outside this workspace

### Install the beta archives

Download the four package archives into your application's `vendor` directory:

```bash
gh release download v0.1.0-beta.1 \
  --repo jakubkontra/react-virtualized-spreadsheets \
  --pattern '*.tgz' --pattern SHA256SUMS --dir vendor
```

For a pnpm application, merge these entries into `package.json`. The overrides keep transitive `@sheet/*` dependencies on the downloaded beta archives instead of looking them up on npm:

```json
{
  "dependencies": {
    "@sheet/core": "file:./vendor/sheet-core-0.1.0-beta.1.tgz",
    "@sheet/react": "file:./vendor/sheet-react-0.1.0-beta.1.tgz",
    "@sheet/transport": "file:./vendor/sheet-transport-0.1.0-beta.1.tgz",
    "@sheet/ui": "file:./vendor/sheet-ui-0.1.0-beta.1.tgz"
  },
  "pnpm": {
    "overrides": {
      "@sheet/core": "file:./vendor/sheet-core-0.1.0-beta.1.tgz",
      "@sheet/react": "file:./vendor/sheet-react-0.1.0-beta.1.tgz",
      "@sheet/transport": "file:./vendor/sheet-transport-0.1.0-beta.1.tgz",
      "@sheet/ui": "file:./vendor/sheet-ui-0.1.0-beta.1.tgz"
    }
  }
}
```

Run `pnpm install`, then follow the [UI setup](../ui.md) for React 19, Tailwind 4 and styles. Headless consumers can omit `@sheet/ui`. The release includes `SHA256SUMS` for verifying the downloaded files with a SHA-256 checksum tool.

### Build your own archives

There is no public npm installation yet. Download all four `.tgz` assets from the [beta release](https://github.com/jakubkontra/react-virtualized-spreadsheets/releases/tag/v0.1.0-beta.1), or build and pack them locally:

```bash
pnpm -r --filter './packages/**' build
mkdir -p artifacts
pnpm --filter @sheet/core pack --pack-destination ../../artifacts
pnpm --filter @sheet/react pack --pack-destination ../../artifacts
pnpm --filter @sheet/transport pack --pack-destination ../../artifacts
pnpm --filter @sheet/ui pack --pack-destination ../../artifacts
```

Install the resulting `sheet-*-0.1.0-beta.1.tgz` files together in your consumer. Workspace dependencies become version dependencies when packed; all matching local packages must be available to the consumer. With pnpm, use overrides for transitive `@sheet/*` dependencies if it otherwise tries the public registry. The repository's `scripts/check-ui-package.mjs` shows a complete isolated tarball installation and build.

```bash
pnpm test:ui-package
```

That check validates the exported JavaScript, declarations and styles. It does not publish packages.

Next: build your [first spreadsheet](first-sheet.mdx).
