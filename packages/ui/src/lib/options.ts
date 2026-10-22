/** Values a native `<option>` can carry without losing identity through `String(value)`. */
export type OptionValue = string | number;

export interface SelectOption<V extends OptionValue> {
  readonly value: V;
  readonly label: string;
}
export type OptionList<V extends OptionValue> = readonly SelectOption<V>[];

/** Options for a closed set of values, labelled from a table that covers every value. */
export function optionsFromLabels<V extends string>(
  values: readonly V[],
  labels: Readonly<Record<V, string>>,
): OptionList<V> {
  return values.map((value) => ({ value, label: labels[value] }));
}

/** Options whose label is the value itself. */
export function optionsFromValues<V extends string>(values: readonly V[]): OptionList<V> {
  return values.map((value) => ({ value, label: value }));
}

/** Resolves the raw `<select>` value back to its typed option. */
export function findOption<V extends OptionValue>(
  options: OptionList<V>,
  raw: string,
): SelectOption<V> | undefined {
  return options.find((option) => String(option.value) === raw);
}
