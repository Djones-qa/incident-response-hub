export type RunbookStepType = 'manual' | 'automated';
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'rolled_back';

export interface TriggerCondition {
  field: string;
  operator: 'equals' | 'contains' | 'gt' | 'lt';
  value: string;
}

export interface RunbookStep {
  order: number;
  name: string;
  type: RunbookStepType;
  command?: string;
  expectedOutcome: string;
  timeout: number;
  retries: number;
}

export interface Runbook {
  id: string;
  name: string;
  description: string;
  triggerConditions: TriggerCondition[];
  steps: RunbookStep[];
  rollbackSteps: RunbookStep[];
  createdAt: string;
  updatedAt: string;
}

export interface StepResult {
  stepOrder: number;
  status: 'success' | 'failed' | 'skipped' | 'timed_out';
  output: string;
  durationMs: number;
  retryCount: number;
}

export interface RunbookExecution {
  id: string;
  incidentId: string;
  runbookId: string;
  status: ExecutionStatus;
  stepResults: StepResult[];
  startedAt: string | null;
  completedAt: string | null;
  lastProgressAt: string | null;
  error: string | null;
}
