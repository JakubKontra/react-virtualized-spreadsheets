# Formula support

Inputs beginning with `=` are parsed into an AST and interpreted. The engine never executes JavaScript from cells. Unsupported syntax returns an error value.

| Capability                                | Examples / behavior                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| Numbers                                   | `12`, `.5`, `1.5e3`; decimal point; no grouping separator                                   |
| Text                                      | `"hello"`; `"a""b"` represents `a"b`                                                        |
| Booleans                                  | `TRUE`, `FALSE` (case insensitive)                                                          |
| Cell references                           | `A1`, `$A$1`, `A$1`, `$A1`; single sheet only                                               |
| Ranges                                    | `A1:B100`; inclusive rectangle; reversed endpoints are normalized                           |
| Unions                                    | `SUM((A1:A3,A8:A9))`; preserves a moved range’s membership                                  |
| Operators                                 | `+ - * / ^ % & = <> < > <= >=`; unary `+`/`-`; parentheses                                  |
| `SUM`                                     | Adds numeric values; ignores text, booleans and blanks                                      |
| `AVERAGE`                                 | Mean of numeric values; no numbers returns `#DIV/0!`                                        |
| `MIN`, `MAX`                              | Numeric minimum/maximum; no numbers returns zero                                            |
| `COUNT`                                   | Counts numeric values                                                                       |
| `IF(test, then, else?)`                   | Evaluates only the selected branch; omitted else returns false                              |
| `COUNTIF(range, criterion)`               | Counts members matching a scalar condition                                                  |
| `SUMIF(range, criterion, sum_range?)`     | Sums matching numeric members; defaults to the criteria range                               |
| `IFERROR(value, fallback)`                | Evaluates the fallback only when the first value is an error                                |
| `ROUND(number, digits)`                   | Rounds decimal places, with ties away from zero; negative digits round tens, hundreds, etc. |
| `AND(condition1, …)`, `OR(condition1, …)` | Combines scalar conditions or ranges; errors propagate even after the result is determined  |
| `NOT(condition)`                          | Reverses one scalar condition                                                               |

Function names are case insensitive, arguments are comma-separated, and there is no localization of the input grammar. Formatting belongs to the renderer and can use `Intl.NumberFormat` for Czech currency/decimal presentation. Functions may accept multiple scalar or range arguments. Aggregate errors propagate, including through `COUNT`.

Arithmetic coerces blank/null to zero, booleans to 0/1 and numeric strings to numbers. Other text in arithmetic produces `#VALUE!`. Aggregates ignore numeric strings rather than coercing them. Comparisons treat null as zero and otherwise follow JavaScript primitive comparisons; equality is strict after null normalization. `IF` uses primitive truthiness (zero, empty string, null and false are false). Text concatenation uses `&` and treats null as empty text.

Precedence, from lowest to highest: comparisons, concatenation, addition/subtraction, multiplication/division, exponentiation, postfix percent. Exponentiation associates right-to-left; unary minus is applied after exponentiation (`-2^2` is `-4`). These explicit rules are not a claim of complete Excel compatibility.

## Conditional and logical functions

`COUNTIF` and `SUMIF` accept a cell, range, or union of ranges as the first argument. Criteria may be numbers, booleans, text, or comparison strings using `=`, `<>`, `<`, `>`, `<=`, `>=`. Numeric and boolean criterion strings are parsed into those types: `"10"` matches numeric 10, not a cell containing text `"10"`. Relational comparisons require matching types; blanks match empty text, not zero. Text comparisons are case insensitive. Equality/inequality support `*` (any text), `?` (one character), and `~*`, `~?`, `~~` for literal wildcard/escape characters. Regex syntax is not accepted.

SUMIF traverses its criteria and sum ranges in their defined order and requires equal member counts. Ranges traverse row by row; unions traverse their parts in order. Removed members are skipped, hidden rows remain included, and wholly removed ranges produce `#REF!`. A mismatch produces `#VALUE!`. Errors in criteria cells propagate; errors in sum cells propagate only when their corresponding criterion matches. Only numeric sum values contribute. Iteration does not materialize the complete dataset into an array or expand range dependency edges.

`AND`/`OR` ignore text and blanks inside ranges and unions; a selection containing no numeric or boolean values produces `#VALUE!`. Scalar arguments, including direct cell references, use the existing `IF` truthiness rules. `NOT` takes one scalar. `IFERROR` catches calculation errors but does not repair malformed formula syntax. Its unused fallback is not evaluated. `ROUND` uses the existing numeric coercion rules and requires integer digits from -308 through 308. Non-finite results produce `#NUM!`; calculations still use JavaScript numbers.

## Editor assistance

The core exports `FORMULA_FUNCTIONS` and `getFormulaFunction()` with signatures, descriptions and argument counts, shared by evaluation and autocomplete. The React hook's `formula` object exposes `diagnostics`, `bracketPair`, `preview`, `canToggleReference`, and `toggleAbsoluteReference()` alongside the existing suggestion and reference APIs. Diagnostics distinguish incomplete input from syntax, unknown-function and argument-count errors. They analyze text only; calculation errors continue to come from the worker/server after commit.

F4 or the floating **Toggle $ reference** button cycles `A1 → $A$1 → A$1 → $A1 → A1`. A selected range changes both endpoints. Quoted strings are ignored; cursor/selection and focus remain in the active editor. The popup previews the parentheses adjacent to the cursor. Pure `analyzeFormulaEditing()` and `toggleFormulaReference()` helpers are also exported for custom renderers.

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

`store.paste(text, { mode, transpose, useInternalFormulas })` adds special paste without changing native copy/paste. `all` retains original inputs, `values` inserts captured computed values, and `formulas` writes only cells whose input starts with `=`, preserving every skipped target. Transposition swaps source row/column offsets; relative references shift from each original cell to its new position, while `$` anchors remain fixed. External formulas retain the references present in the pasted text because their source position is unknown. Formatting is not copied.

Internal clipboard data now optionally carries a typed `values` matrix alongside inputs and TSV; older clipboard objects remain accepted. Internal values preserve numeric-looking text, booleans and empty strings. External values use the normal TSV number/boolean parsing. Strings are escaped with a leading apostrophe so text beginning with `=` cannot become a formula in values mode. Error results are pasted as their error-code text. A literal leading apostrophe is doubled; original-content internal copies preserve escapes. This input convention applies to source data and persisted inputs as well: an initial apostrophe is now an escape, rather than a displayed character.

Special paste uses the existing limits and validation, loads bounded target blocks, checks that the sheet did not change during preparation, and commits one atomic undo transaction. An all-constant formulas-only paste is a no-op. The demo dialog keeps the captured data after a rejected paste, allowing mode changes or cancellation without partial writes.

Local per-cell edits can override a column template. In server mode, editing any calculated-column cell updates that column's template: `=D5*E5` edited at row 5 is stored as `=D1*E1`. Absolute references stay anchored. Pasting into multiple rows of one server column requires all pasted formulas to normalize to the same template; inconsistent formulas or literal values are rejected atomically. Delete clears cells within the edit limit; in server mode these edits clear the affected calculated column templates. Source cells are read-only; custom view rows can contain values. All these writes are atomic, revision checked and undoable within the current client session.

## References in a view

Formulas are stored against stable canonical source/custom identities. The formula bar shows A1 labels in the current logical order, including hidden items. Moving a referenced row or column changes the displayed reference without changing its target or calculated result. Hidden rows remain part of aggregates. A jump to a hidden address is rejected; restore the row or column to navigate to it.

Ranges retain the membership they had when entered. Reordering or inserting between those members may display a union such as `=SUM((A1:A2,A5:A5))`; a newly inserted row does not silently join an existing range. Removing a custom item makes direct references `#REF!`. Ranges omit removed members, returning `#REF!` if the entire range is gone. Undo restores identities and references. Source items are hidden rather than removed.

Binding and display use the parser, so structural changes may normalize parentheses and whitespace. Relative clipboard offsets use logical positions, including hidden rows/columns. `$` anchors continue to control copying; they do not prevent a reference from following a moved identity. Column templates shift in canonical source-row space, so a calculation remains attached to its record after row reorder. Custom-row per-cell values can override templates in both modes.
