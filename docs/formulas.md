# Formula support

Inputs beginning with `=` are parsed into an AST and interpreted. The engine never executes JavaScript from cells. Unsupported syntax returns an error value.

| Capability              | Examples / behavior                                               |
| ----------------------- | ----------------------------------------------------------------- |
| Numbers                 | `12`, `.5`, `1.5e3`; decimal point; no grouping separator         |
| Text                    | `"hello"`; `"a""b"` represents `a"b`                              |
| Booleans                | `TRUE`, `FALSE` (case insensitive)                                |
| Cell references         | `A1`, `$A$1`, `A$1`, `$A1`; single sheet only                     |
| Ranges                  | `A1:B100`; inclusive rectangle; reversed endpoints are normalized |
| Operators               | `+ - * / ^ % & = <> < > <= >=`; unary `+`/`-`; parentheses        |
| `SUM`                   | Adds numeric values; ignores text, booleans and blanks            |
| `AVERAGE`               | Mean of numeric values; no numbers returns `#DIV/0!`              |
| `MIN`, `MAX`            | Numeric minimum/maximum; no numbers returns zero                  |
| `COUNT`                 | Counts numeric values                                             |
| `IF(test, then, else?)` | Evaluates only the selected branch; omitted else returns false    |

Function names are case insensitive, arguments are comma-separated, and there is no localization of the input grammar. Formatting belongs to the renderer and can use `Intl.NumberFormat` for Czech currency/decimal presentation. Functions may accept multiple scalar or range arguments. Aggregate errors propagate, including through `COUNT`.

Arithmetic coerces blank/null to zero, booleans to 0/1 and numeric strings to numbers. Other text in arithmetic produces `#VALUE!`. Aggregates ignore numeric strings rather than coercing them. Comparisons treat null as zero and otherwise follow JavaScript primitive comparisons; equality is strict after null normalization. `IF` uses primitive truthiness (zero, empty string, null and false are false). Text concatenation uses `&` and treats null as empty text.

Precedence, from lowest to highest: comparisons, concatenation, addition/subtraction, multiplication/division, exponentiation, postfix percent. Exponentiation associates right-to-left; unary minus is applied after exponentiation (`-2^2` is `-4`). These explicit rules are not a claim of complete Excel compatibility.

## Errors and limits

`CellValue` is a primitive or `{ error, message }`. The renderer should show the error code and may expose the message in a tooltip.

| Error     | Meaning                                                            |
| --------- | ------------------------------------------------------------------ |
| `#ERROR!` | Malformed formula or parser limits exceeded                        |
| `#REF!`   | Reference outside the sheet or a copy shifted past row/column zero |
| `#VALUE!` | Invalid numeric operand, argument count or range used as a scalar  |
| `#DIV/0!` | Division by zero or empty average                                  |
| `#NAME?`  | Unsupported function                                               |
| `#CYCLE!` | Circular dependency                                                |
| `#NUM!`   | Non-finite result or dependency depth above 256                    |

The parser caps nesting at 128 and tokens at 2,048. The demo API caps formula strings at 8,192 characters. There are no scripts, asynchronous custom functions, volatile functions, whole-column references, named ranges, spilled arrays or cross-sheet references.

## Recalculation and copying

Direct dependencies and range dependencies are recorded separately. A range is not expanded into a graph edge per source cell. Writes invalidate cached dependents; reads evaluate invalidated formulas lazily. The engine caches up to 10,000 formula values and 2,048 parsed expressions by default. If eviction makes the dependency graph incomplete, the next write clears the bounded value cache to preserve correctness. Identical complete formula expressions share a result within the same data revision.

Internal copying preserves formulas and adjusts relative references; `$` anchors stay fixed. Quoted text that happens to look like an address is unchanged. External TSV copying uses displayed raw values (without currency formatting), and external paste parses numbers, booleans and formulas. TSV handles tabs, newlines and doubled quotes in quoted fields. The React clipboard handler uses a custom MIME token to identify this store's latest copy; identical text copied from another application does not accidentally restore an old formula. If the browser removes the custom MIME format, paste falls back to values. Imperative callers can use `paste(text, false)` to explicitly paste external text.

Local per-cell edits can override a column template. In server mode, editing any calculated-column cell updates that column's template: `=D5*E5` edited at row 5 is stored as `=D1*E1`. Absolute references stay anchored. Pasting into multiple rows of one server column requires all pasted formulas to normalize to the same template; inconsistent formulas or literal values are rejected atomically. Delete clears the selected calculated column templates. Source cells are read-only. All these writes are atomic, revision checked and undoable within the current client session.
