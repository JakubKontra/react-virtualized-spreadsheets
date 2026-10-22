import {
  filterValue,
  operatorTakesValue,
  withRuleOperator,
  withRuleValue,
  type CanonicalCol,
  type ConditionalRule,
} from '@sheet/core';
import { Button } from '../components/button';
import { Input } from '../components/input';
import { OptionSelect } from '../fields/OptionSelect';
import { removeAt, replaceAt } from '../lib/arrays';
import { OPERATOR_OPTIONS } from './operator-options';

const MAX_RULES = 32;

export interface ConditionalRulesProps {
  /** Column new rules apply to. */
  readonly col: CanonicalCol;
  readonly rules: readonly ConditionalRule[];
  readonly onChange: (rules: readonly ConditionalRule[]) => void;
}

export function ConditionalRules({ col, rules, onChange }: ConditionalRulesProps) {
  const update = (index: number, rule: ConditionalRule) => onChange(replaceAt(rules, index, rule));
  return (
    <>
      <h3>Conditional formatting</h3>
      {rules.map((rule, i) => (
        <div className="control-row filter-row" key={rule.id}>
          <OptionSelect
            aria-label={`Rule condition ${i + 1}`}
            options={OPERATOR_OPTIONS}
            value={rule.operator}
            onValueChange={(operator) => update(i, withRuleOperator(rule, operator))}
          />
          {operatorTakesValue(rule.operator) && (
            <Input
              aria-label={`Rule value ${i + 1}`}
              value={String(filterValue(rule) ?? '')}
              onChange={(event) => update(i, withRuleValue(rule, event.target.value))}
            />
          )}
          <Input
            type="color"
            aria-label={`Rule background ${i + 1}`}
            value={rule.background}
            onChange={(event) => update(i, { ...rule, background: event.target.value })}
          />
          <Input
            type="color"
            aria-label={`Rule text color ${i + 1}`}
            value={rule.color}
            onChange={(event) => update(i, { ...rule, color: event.target.value })}
          />
          <Button
            variant="outline"
            type="button"
            aria-label={`Remove rule ${i + 1}`}
            onClick={() => onChange(removeAt(rules, i))}
          >
            ×
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        type="button"
        disabled={rules.length >= MAX_RULES}
        onClick={() =>
          onChange([
            ...rules,
            {
              id: crypto.randomUUID(),
              col,
              operator: 'lt',
              value: 0,
              color: '#9f1239',
              background: '#ffe4e6',
            },
          ])
        }
      >
        + Add rule
      </Button>
    </>
  );
}
