import { FILTER_OPERATORS } from '@sheet/core';
import { FILTER_OPERATOR_LABELS } from '../lib/labels';
import { optionsFromLabels } from '../lib/options';

/** Shared by filters and conditional-formatting rules. */
export const OPERATOR_OPTIONS = optionsFromLabels(FILTER_OPERATORS, FILTER_OPERATOR_LABELS);
