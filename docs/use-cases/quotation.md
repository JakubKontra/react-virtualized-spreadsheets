# Quotations and scenario planning

Embed a spreadsheet where users need to explore quantities, rates and discounts before committing a proposal. The [quotation example](../examples/quotation.mdx) starts with three services and a total row.

## Calculation model

| Column        | Input / calculation                |
| ------------- | ---------------------------------- |
| A: Service    | Text                               |
| B: Quantity   | Number                             |
| C: Unit price | Number formatted as EUR            |
| D: Discount   | Fraction displayed as a percentage |
| E: Line total | `=B1*C1*(1-D1)`                    |

The total uses `=SUM(E1:E3)`. These formulas refer to a fixed range: adding a new line does not invent business rules or automatically extend the quotation's total. A host action should insert the row and explicitly update the intended total formula.

## Application integration

Use `renderToolbar` for application actions such as **Save draft**. Await `sheet.commitEdit()` first and stop if it returns false; then persist through your application's own service. The live example intentionally resets when the page reloads.

Treat saved view state, product catalog data and approved quotation records as separate application concerns. `ViewPersistenceBinding` saves view definitions; it is not an invoicing backend. Use server-side validation for an approved financial document.

The current engine uses JavaScript numbers. Displaying two decimal places does not apply a domain-specific rounding policy to calculations. Use explicit `ROUND` where required and test your business rules. See [formula semantics](../formulas.md).
