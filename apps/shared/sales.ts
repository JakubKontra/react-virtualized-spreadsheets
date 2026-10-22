import { FormulaEngine, type Address, type CellInput } from '@sheet/core';
export const SALES_FORMULAS: Record<number, string> = { 6: '=D1*E1*(1-F1)', 7: '=G1*0.24' };
export const SALES_COLUMNS = [
  'Order',
  'Date',
  'Customer',
  'Units',
  'Unit price',
  'Discount',
  'Revenue',
  'Margin',
];
const customers = [
  'Northstar Motors',
  'Atlas Auto',
  'Summit Garage',
  'Urban Drive',
  'Apex Mobility',
  'Cedar Automotive',
];
export function saleInput({ row, col }: Address): CellInput {
  switch (col) {
    case 0:
      return `ORD-${String(row + 1).padStart(7, '0')}`;
    case 1:
      return `2026-10-${String((row % 22) + 1).padStart(2, '0')}`;
    case 2:
      return customers[row % customers.length];
    case 3:
      return (row % 9) + 1;
    case 4:
      return 120 + ((row * 17) % 880);
    case 5:
      return (row % 5) / 100;
    default:
      return null;
  }
}
export function createSalesEngine(rows: number) {
  return new FormulaEngine({
    rows,
    columns: 50,
    readInput: saleInput,
    columnFormulas: SALES_FORMULAS,
  });
}
