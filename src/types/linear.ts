export interface StoredLinearIssue {
  id: string;
  identifier: string;
  team_id: string;
  team_name: string;
  title: string;
  state_name: string;
  state_type: string;
  assignee: string | null;
  estimate: number | null;
  priority: number | null;
  url: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  due_date: string | null;
  fetched_at: string;
}

export interface StoredLinearCycle {
  id: string;
  team_id: string;
  name: string | null;
  number: number;
  starts_at: string;
  ends_at: string;
  progress: number;
  fetched_at: string;
}

export interface StoredLinearTeam {
  id: string;
  name: string;
  key: string;
  fetched_at: string;
}
