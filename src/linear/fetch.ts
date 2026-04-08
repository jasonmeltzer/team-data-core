import type { StoredLinearIssue, StoredLinearCycle, StoredLinearTeam } from "../types/linear.js";
import { upsertLinearIssues, upsertLinearCycles, upsertLinearTeam } from "./store.js";

const LINEAR_API = "https://api.linear.app/graphql";

async function linearQuery<T>(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(LINEAR_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Linear API error: ${res.status} ${text}`);
  }
  const json = await res.json() as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors) {
    throw new Error(
      `Linear GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`
    );
  }
  return json.data as T;
}

interface LinearIssueNode {
  id: string;
  identifier: string;
  title: string;
  priority: number | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  dueDate: string | null;
  estimate: number | null;
  state: { name: string; type: string };
  assignee: { name: string } | null;
  team: { id: string; name: string };
}

interface IssueQueryResult {
  issues: {
    nodes: LinearIssueNode[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

interface LinearCycleNode {
  id: string;
  name: string | null;
  number: number;
  startsAt: string;
  endsAt: string;
  progress: number;
}

interface LinearTeamNode {
  id: string;
  name: string;
  key: string;
}

export async function fetchAndStoreLinearIssues(
  apiKey: string,
  teamId: string,
  options: { lookbackDays?: number; dbPath?: string } = {}
): Promise<{ issueCount: number }> {
  const { lookbackDays = 42, dbPath } = options;
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const fetchedAt = new Date().toISOString();

  const allIssues: StoredLinearIssue[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    // eslint-disable-next-line no-await-in-loop
    const page: IssueQueryResult = await linearQuery<IssueQueryResult>(
      apiKey,
      `query($teamId: String!, $since: DateTimeOrDuration!, $cursor: String) {
        issues(
          first: 100,
          after: $cursor,
          filter: {
            team: { id: { eq: $teamId } },
            updatedAt: { gte: $since }
          }
        ) {
          nodes {
            id identifier title priority url createdAt updatedAt
            startedAt completedAt dueDate estimate
            state { name type }
            assignee { name }
            team { id name }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { teamId, since, cursor: cursor ?? undefined }
    );

    for (const node of page.issues.nodes) {
      allIssues.push({
        id: node.id,
        identifier: node.identifier,
        team_id: node.team.id,
        team_name: node.team.name,
        title: node.title,
        state_name: node.state.name,
        state_type: node.state.type,
        assignee: node.assignee?.name ?? null,
        estimate: node.estimate,
        priority: node.priority,
        url: node.url,
        created_at: node.createdAt,
        updated_at: node.updatedAt,
        started_at: node.startedAt,
        completed_at: node.completedAt,
        due_date: node.dueDate,
        fetched_at: fetchedAt,
      });
    }

    hasNextPage = page.issues.pageInfo.hasNextPage;
    cursor = page.issues.pageInfo.endCursor;
  }

  upsertLinearIssues(allIssues, dbPath);
  return { issueCount: allIssues.length };
}

export async function fetchAndStoreLinearCycles(
  apiKey: string,
  teamId: string,
  options: { lookbackDays?: number; dbPath?: string } = {}
): Promise<{ cycleCount: number }> {
  const { lookbackDays = 42, dbPath } = options;
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const fetchedAt = new Date().toISOString();

  const data = await linearQuery<{
    team: {
      id: string;
      name: string;
      key: string;
      cycles: { nodes: LinearCycleNode[] };
    };
  }>(
    apiKey,
    `query($teamId: String!) {
      team(id: $teamId) {
        id name key
        cycles(first: 50, orderBy: { field: createdAt, direction: Descending }) {
          nodes { id name number startsAt endsAt progress }
        }
      }
    }`,
    { teamId }
  );

  if (!data.team) {
    return { cycleCount: 0 };
  }

  // Upsert the team
  const team: StoredLinearTeam = {
    id: data.team.id,
    name: data.team.name,
    key: data.team.key,
    fetched_at: fetchedAt,
  };
  upsertLinearTeam(team, dbPath);

  // Filter and upsert cycles
  const cycles: StoredLinearCycle[] = data.team.cycles.nodes
    .filter((c) => c.endsAt >= since)
    .map((c) => ({
      id: c.id,
      team_id: data.team.id,
      name: c.name,
      number: c.number,
      starts_at: c.startsAt,
      ends_at: c.endsAt,
      progress: c.progress,
      fetched_at: fetchedAt,
    }));

  upsertLinearCycles(cycles, dbPath);
  return { cycleCount: cycles.length };
}
