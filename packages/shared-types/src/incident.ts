export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type IncidentStatus = 'declared' | 'investigating' | 'mitigating' | 'resolved' | 'closed';

export interface Incident {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  status: IncidentStatus;
  affectedServices: string[];
  assignedResponders: string[];
  declaredAt: string;
  createdAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  updatedAt: string;
}

export interface IncidentDeclarationRequest {
  title: string;
  description: string;
  severity: Severity;
  affectedServices: string[];
}

export interface IncidentListQuery {
  status?: IncidentStatus;
  severity?: Severity;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
