export interface StoredPR {
  id: string;
  repo: string;
  owner: string;
  number: number;
  title: string;
  author: string;
  state: string;
  is_draft: number;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  closed_at: string | null;
  additions: number;
  deletions: number;
  team: string | null;
  fetched_at: string;
}

export interface StoredReview {
  id: string;
  pr_id: string;
  reviewer: string;
  avatar_url: string | null;
  state: string;
  submitted_at: string;
}

export interface StoredDeployment {
  id: string;
  repo: string;
  owner: string;
  environment: string;
  status: string;
  sha: string | null;
  ref: string | null;
  creator: string | null;
  description: string | null;
  caused_incident: number;
  created_at: string;
  completed_at: string | null;
  team: string | null;
  fetched_at: string;
}
