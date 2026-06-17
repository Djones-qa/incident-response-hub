/**
 * HTTP request factory for testing Express routes.
 * Provides helpers to construct mock Request/Response objects for unit testing handlers.
 */

import type { Severity, IncidentStatus, TimelineEntryType, NotificationChannel } from '@incident-hub/shared-types';

// --- Mock Request/Response types ---

export interface MockRequest {
  method: string;
  url: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string | string[] | undefined>;
  body: unknown;
  headers: Record<string, string>;
  get(name: string): string | undefined;
}

export interface MockResponse {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  status(code: number): MockResponse;
  json(data: unknown): MockResponse;
  send(data?: unknown): MockResponse;
  set(name: string, value: string): MockResponse;
  getHeader(name: string): string | undefined;
  /** Tracks whether response was sent */
  ended: boolean;
}

/**
 * Creates a mock Express-like request object.
 */
export function createMockRequest(overrides?: Partial<MockRequest>): MockRequest {
  const req: MockRequest = {
    method: 'GET',
    url: '/',
    path: '/',
    params: {},
    query: {},
    body: undefined,
    headers: { 'content-type': 'application/json' },
    get(name: string): string | undefined {
      return this.headers[name.toLowerCase()];
    },
    ...overrides,
  };
  return req;
}

/**
 * Creates a mock Express-like response object.
 * Captures status code, headers, and response body for assertions.
 */
export function createMockResponse(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    body: undefined,
    headers: {},
    ended: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: unknown) {
      this.body = data;
      this.headers['content-type'] = 'application/json';
      this.ended = true;
      return this;
    },
    send(data?: unknown) {
      this.body = data;
      this.ended = true;
      return this;
    },
    set(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    getHeader(name: string): string | undefined {
      return this.headers[name.toLowerCase()];
    },
  };
  return res;
}

// --- Request Builders ---

/**
 * Builds a POST /incidents request body for incident declaration.
 */
export function buildIncidentDeclarationRequest(overrides?: {
  title?: string;
  description?: string;
  severity?: Severity;
  affectedServices?: string[];
}): MockRequest {
  return createMockRequest({
    method: 'POST',
    url: '/incidents',
    path: '/incidents',
    body: {
      title: overrides?.title ?? 'Test Incident',
      description: overrides?.description ?? 'Test description for an incident',
      severity: overrides?.severity ?? 'high',
      affectedServices: overrides?.affectedServices ?? ['api-gateway'],
    },
  });
}

/**
 * Builds a GET /incidents request with optional query filters.
 */
export function buildIncidentListRequest(filters?: {
  status?: IncidentStatus;
  severity?: Severity;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}): MockRequest {
  const query: Record<string, string | undefined> = {};
  if (filters?.status) query['status'] = filters.status;
  if (filters?.severity) query['severity'] = filters.severity;
  if (filters?.startDate) query['startDate'] = filters.startDate;
  if (filters?.endDate) query['endDate'] = filters.endDate;
  if (filters?.page) query['page'] = String(filters.page);
  if (filters?.pageSize) query['pageSize'] = String(filters.pageSize);

  return createMockRequest({
    method: 'GET',
    url: '/incidents',
    path: '/incidents',
    query: query as Record<string, string>,
  });
}

/**
 * Builds a PATCH /incidents/:id/status request.
 */
export function buildStatusTransitionRequest(
  incidentId: string,
  targetStatus: IncidentStatus
): MockRequest {
  return createMockRequest({
    method: 'PATCH',
    url: `/incidents/${incidentId}/status`,
    path: `/incidents/${incidentId}/status`,
    params: { id: incidentId },
    body: { status: targetStatus },
  });
}

/**
 * Builds a PATCH /incidents/:id/severity request.
 */
export function buildSeverityEscalationRequest(
  incidentId: string,
  targetSeverity: Severity
): MockRequest {
  return createMockRequest({
    method: 'PATCH',
    url: `/incidents/${incidentId}/severity`,
    path: `/incidents/${incidentId}/severity`,
    params: { id: incidentId },
    body: { severity: targetSeverity },
  });
}

/**
 * Builds a POST /incidents/:id/timeline request.
 */
export function buildTimelineEntryRequest(
  incidentId: string,
  overrides?: {
    type?: TimelineEntryType;
    author?: string;
    content?: string;
    metadata?: Record<string, string>;
  }
): MockRequest {
  return createMockRequest({
    method: 'POST',
    url: `/incidents/${incidentId}/timeline`,
    path: `/incidents/${incidentId}/timeline`,
    params: { id: incidentId },
    body: {
      type: overrides?.type ?? 'note',
      author: overrides?.author ?? 'test-user',
      content: overrides?.content ?? 'Test timeline entry content',
      ...(overrides?.metadata && { metadata: overrides.metadata }),
    },
  });
}

/**
 * Builds a POST /incidents/:id/responders request.
 */
export function buildResponderAssignmentRequest(
  incidentId: string,
  responders: string[]
): MockRequest {
  return createMockRequest({
    method: 'POST',
    url: `/incidents/${incidentId}/responders`,
    path: `/incidents/${incidentId}/responders`,
    params: { id: incidentId },
    body: { responders },
  });
}

/**
 * Builds a POST /notifications request.
 */
export function buildNotificationRequest(overrides?: {
  channel?: NotificationChannel;
  recipients?: string[];
  message?: string;
  incidentId?: string;
}): MockRequest {
  return createMockRequest({
    method: 'POST',
    url: '/notifications',
    path: '/notifications',
    body: {
      channel: overrides?.channel ?? 'slack',
      recipients: overrides?.recipients ?? ['user-1'],
      message: overrides?.message ?? 'Test notification message',
      incidentId: overrides?.incidentId ?? 'test-incident-id',
    },
  });
}

/**
 * Builds a POST /escalation-policies request.
 */
export function buildEscalationPolicyRequest(overrides?: {
  name?: string;
  levels?: Array<{
    targets: string[];
    notifyAfter: number;
    channels: NotificationChannel[];
  }>;
}): MockRequest {
  return createMockRequest({
    method: 'POST',
    url: '/escalation-policies',
    path: '/escalation-policies',
    body: {
      name: overrides?.name ?? 'Test Policy',
      levels: overrides?.levels ?? [
        { targets: ['user-1'], notifyAfter: 5, channels: ['slack'] },
        { targets: ['user-2'], notifyAfter: 15, channels: ['slack', 'pagerduty'] },
      ],
    },
  });
}

/**
 * Builds a POST /runbooks request.
 */
export function buildRunbookRequest(overrides?: {
  name?: string;
  description?: string;
  triggerConditions?: Array<{ field: string; operator: string; value: string }>;
  steps?: Array<{
    order: number;
    name: string;
    type: string;
    command?: string;
    expectedOutcome: string;
    timeout: number;
    retries: number;
  }>;
  rollbackSteps?: Array<{
    order: number;
    name: string;
    type: string;
    command?: string;
    expectedOutcome: string;
    timeout: number;
    retries: number;
  }>;
}): MockRequest {
  return createMockRequest({
    method: 'POST',
    url: '/runbooks',
    path: '/runbooks',
    body: {
      name: overrides?.name ?? 'Test Runbook',
      description: overrides?.description ?? 'A test runbook for automated remediation',
      triggerConditions: overrides?.triggerConditions ?? [
        { field: 'severity', operator: 'equals', value: 'critical' },
      ],
      steps: overrides?.steps ?? [
        {
          order: 1,
          name: 'Check service health',
          type: 'automated',
          command: 'curl http://localhost/health',
          expectedOutcome: 'Service responds with 200',
          timeout: 30,
          retries: 3,
        },
      ],
      rollbackSteps: overrides?.rollbackSteps ?? [
        {
          order: 1,
          name: 'Rollback deployment',
          type: 'automated',
          command: 'kubectl rollout undo deployment/app',
          expectedOutcome: 'Deployment rolled back',
          timeout: 60,
          retries: 1,
        },
      ],
    },
  });
}
