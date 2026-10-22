import { EngineSession } from '@sheet/core';
import { installCalculationWorker } from '@sheet/transport';
import { createSalesEngine } from '../../shared/sales';
installCalculationWorker(new EngineSession(createSalesEngine(100000)), self);
