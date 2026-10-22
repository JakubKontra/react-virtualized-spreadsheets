# Inventory and operations

Use a spreadsheet for internal workflows where people need to inspect many records, update quantities, filter exceptions and calculate derived values without leaving the application.

The [inventory example](../examples/inventory.mdx) models a part catalog with quantity, availability, unit price and stock value. It has 300 generated records, a fixed first column and a low-stock filter.

## Model the data

Keep the part identity in your source, use numeric quantities, and constrain availability with a `select` column. Compute stock value with a formula such as `=B1*D1`. Formatting the result as currency does not change the calculated value.

Use `columnOptions` for typed inputs, `conditionalRules` for low-stock highlighting, and `query.filters` for the operational queue. These settings reference canonical column indexes, so moving columns does not change which field a rule applies to.

## Connect real inventory

For a complete local snapshot, replace the example's `readInput` function and move its calculator into a worker. For authoritative shared inventory, implement a server-backed source with application-specific write authorization and conflict handling. The included sales server is a protocol example; it does not implement inventory writes.

Keep record updates distinct from view layout changes. Hiding a row changes the view; it does not delete an inventory item. Require successful mutation responses before showing a saved state. View persistence saves layout and overrides, not an external inventory database.

## Verify the workflow

Edit a quantity and verify the stock value; filter low stock and ensure matching rows outside the viewport are included. Reorder a column and verify the type and rules follow it. Reject invalid choices and stale writes without losing the user's draft.

See [interaction settings](../guides/interactions.md) and [data-source contracts](../api/adapters.md).
