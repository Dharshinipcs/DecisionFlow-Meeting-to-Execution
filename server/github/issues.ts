export interface GitHubConfigStatus {
  configured: boolean;
  owner: string | null;
  repo: string | null;
  missingVars: string[];
}

export interface GitHubIssueResult {
  issueNumber: number;
  issueUrl: string;
  state: string;
}

export function getGitHubConfigStatus(): GitHubConfigStatus {
  const token = process.env.GITHUB_TOKEN?.trim();
  const owner = process.env.GITHUB_OWNER?.trim() || null;
  const repo = process.env.GITHUB_REPO?.trim() || null;

  const missingVars: string[] = [];
  if (!token) missingVars.push('GITHUB_TOKEN');
  if (!owner) missingVars.push('GITHUB_OWNER');
  if (!repo) missingVars.push('GITHUB_REPO');

  return {
    configured: missingVars.length === 0,
    owner,
    repo,
    missingVars,
  };
}

export async function createGitHubIssue(params: {
  title: string;
  body: string;
  labels?: string[];
}): Promise<GitHubIssueResult> {
  const config = getGitHubConfigStatus();
  const token = process.env.GITHUB_TOKEN?.trim();

  if (!config.configured || !token || !config.owner || !config.repo) {
    throw new Error(
      `GitHub integration is not configured. Missing environment variables: ${config.missingVars.join(', ')}. Configure these server-side secrets to create real GitHub issues.`
    );
  }

  const endpoint = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/issues`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'DecisionFlow-Agent',
    },
    body: JSON.stringify({
      title: params.title,
      body: params.body,
      labels: params.labels ?? ['decisionflow'],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`GitHub API error (${response.status}): ${errText.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    number: number;
    html_url: string;
    state: string;
  };

  return {
    issueNumber: data.number,
    issueUrl: data.html_url,
    state: data.state,
  };
}

export async function fetchGitHubIssueState(issueNumber: string): Promise<{ state: string; htmlUrl: string }> {
  const config = getGitHubConfigStatus();
  const token = process.env.GITHUB_TOKEN?.trim();

  if (!config.configured || !token || !config.owner || !config.repo) {
    throw new Error(
      `GitHub integration is not configured. Missing: ${config.missingVars.join(', ')}.`
    );
  }

  const endpoint = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/issues/${encodeURIComponent(issueNumber)}`;
  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'DecisionFlow-Agent',
    },
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`GitHub sync error (${response.status}): ${errText.slice(0, 300)}`);
  }

  const data = (await response.json()) as { state: string; html_url: string };
  return {
    state: data.state,
    htmlUrl: data.html_url,
  };
}
