// Fails when library or server code escapes the type system: `any`, `@ts-ignore`, non-null
// assertions, or `as` casts beyond the audited counts in ALLOWED_CASTS. Uses the TypeScript AST.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const root = new URL('..', import.meta.url).pathname;
const ROOTS = [
  'packages/core/src',
  'packages/transport/src',
  'packages/react/src',
  'packages/ui/src',
  'apps/server/src',
  'apps/shared',
];
// Vendored shadcn/ui components follow upstream style.
const IGNORED = ['packages/ui/src/components/'];

/** Audited casts per file; each one is justified by a comment at the cast site. */
const ALLOWED_CASTS = {
  'packages/core/src/brand.ts': 10,
  'packages/core/src/coords.ts': 3,
  'packages/core/src/assert.ts': 1,
  'packages/core/src/validate.ts': 4,
  'packages/core/src/store/block-cache.ts': 1,
  'packages/transport/src/protocol/core.ts': 1,
  'packages/transport/src/protocol/http.ts': 1,
  'packages/transport/src/rpc.ts': 5,
};

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) yield path;
  }
}

const isConstAssertion = (node) =>
  ts.isTypeReferenceNode(node.type) && node.type.typeName.getText() === 'const';

const problems = [];
for (const base of ROOTS) {
  for (const path of files(join(root, base))) {
    const file = relative(root, path);
    if (IGNORED.some((prefix) => file.startsWith(prefix))) continue;
    const text = readFileSync(path, 'utf8');
    const source = ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      true,
      path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const report = (node, rule) => {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      problems.push(`${file}:${line + 1}: ${rule}: ${node.getText().split('\n')[0]}`);
    };
    let casts = 0;
    const visit = (node) => {
      if (node.kind === ts.SyntaxKind.AnyKeyword) report(node, 'any');
      else if (ts.isNonNullExpression(node)) report(node, 'non-null assertion');
      else if (
        (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
        !isConstAssertion(node)
      )
        if (++casts > (ALLOWED_CASTS[file] ?? 0)) report(node, 'unaudited cast');
      ts.forEachChild(node, visit);
    };
    visit(source);
    text.split('\n').forEach((line, i) => {
      if (/@ts-(?:ignore|nocheck|expect-error)/.test(line))
        problems.push(`${file}:${i + 1}: suppressed type error: ${line.trim()}`);
    });
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} type-safety problem(s).`);
  process.exit(1);
}
console.log('Type safety check passed.');
