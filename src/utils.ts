import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { getPreferenceValues } from "@raycast/api";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// ─── Workflow Definition ──────────────────────────────────────────────────────

export type WorkflowStatus =
  | "Waiting"
  | "Doing"
  | "Integration"
  | "1ST REVIEW"
  | "Testing"
  | "2ND REVIEW"
  | "UAT"
  | "Staging"
  | "Regression"
  | "Delivering"
  | "Done";

export interface WorkflowStep {
  status: WorkflowStatus;
  emoji: string;
  color: string;
  description: string;
}

export const WORKFLOW: WorkflowStep[] = [
  { status: "Waiting", emoji: "📋", color: "#8B9EB0", description: "Waiting to be started" },
  { status: "Doing", emoji: "🔨", color: "#F4A261", description: "Actively in development" },
  { status: "Integration", emoji: "🔗", color: "#E9C46A", description: "Integrating with other services" },
  { status: "1ST REVIEW", emoji: "👀", color: "#2A9D8F", description: "First code review" },
  { status: "Testing", emoji: "🧪", color: "#4361EE", description: "QA / manual testing" },
  { status: "2ND REVIEW", emoji: "🔍", color: "#7209B7", description: "Second code review" },
  { status: "UAT", emoji: "✅", color: "#3A86FF", description: "User acceptance testing" },
  { status: "Staging", emoji: "🚀", color: "#FF6B6B", description: "Deployed to staging" },
  { status: "Regression", emoji: "🔄", color: "#FB8500", description: "Regression testing" },
  { status: "Delivering", emoji: "📦", color: "#6A4C93", description: "Delivering to production" },
  { status: "Done", emoji: "🎉", color: "#2DC653", description: "Completed" },
];

export const WORKFLOW_MAP = new Map<string, WorkflowStep>(
  WORKFLOW.map((step) => [normalizeStatus(step.status), step]),
);

export function normalizeStatus(status: string): string {
  return status.trim().toUpperCase();
}

export function getWorkflowStep(status: string): WorkflowStep | undefined {
  return WORKFLOW_MAP.get(normalizeStatus(status));
}

export function getWorkflowIndex(status: string): number {
  return WORKFLOW.findIndex((s) => normalizeStatus(s.status) === normalizeStatus(status));
}

export function getNextStatus(currentStatus: string): WorkflowStep | null {
  const idx = getWorkflowIndex(currentStatus);
  if (idx === -1 || idx >= WORKFLOW.length - 1) return null;
  return WORKFLOW[idx + 1];
}

export function getPreviousStatus(currentStatus: string): WorkflowStep | null {
  const idx = getWorkflowIndex(currentStatus);
  if (idx <= 0) return null;
  return WORKFLOW[idx - 1];
}

export function getRemainingSteps(currentStatus: string): WorkflowStep[] {
  const idx = getWorkflowIndex(currentStatus);
  if (idx === -1) return [];
  return WORKFLOW.slice(idx + 1);
}

// ─── Jira CLI Helpers ─────────────────────────────────────────────────────────

interface Preferences {
  jiraCliPath: string;
  jiraProject: string;
  jiraApiToken: string;
}

function getPrefs(): Preferences {
  return getPreferenceValues<Preferences>();
}

function getJiraCliPath(): string {
  return getPrefs().jiraCliPath || "jira";
}

export function getDefaultProject(): string {
  return getPrefs().jiraProject || "";
}

function shellEnv(): Record<string, string> {
  const extras = ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"];
  const existing = process.env.PATH || "";
  const prefs = getPrefs();
  return {
    ...process.env,
    PATH: [...extras, existing].join(":"),
    HOME: process.env.HOME || `/Users/${process.env.USER || ""}`,
    ...(prefs.jiraApiToken ? { JIRA_API_TOKEN: prefs.jiraApiToken } : {}),
  } as Record<string, string>;
}

async function runJira(args: string): Promise<string> {
  const cli = getJiraCliPath();
  const cmd = `${cli} ${args}`;
  try {
    const { stdout } = await execAsync(cmd, {
      env: shellEnv(),
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Strip ANSI escape codes from error messages
    // eslint-disable-next-line no-control-regex
    const clean = msg.replaceAll(/\u001b\[[0-9;]*m/g, "");
    throw new Error(`jira CLI (exit 1): ${clean}`);
  }
}

/**
 * Resolve ticket key from argument or clipboard.
 * Handles bare numbers ("123") by prepending default project prefix.
 */
export async function resolveTicketKey(argument: string | undefined): Promise<string> {
  let raw = argument?.trim() || "";

  if (!raw) {
    const { Clipboard } = await import("@raycast/api");
    raw = (await Clipboard.readText()) || "";
  }

  raw = raw.trim();

  if (/^\d+$/.test(raw)) {
    const project = getDefaultProject();
    if (!project)
      throw new Error("Ticket number provided without project prefix, and no default project is set in preferences.");
    raw = `${project}-${raw}`;
  }

  if (!/^[A-Z][A-Z0-9_]+-\d+$/i.test(raw)) {
    throw new Error(`"${raw}" doesn't look like a valid Jira ticket key (expected format: PROJ-123).`);
  }

  return raw.toUpperCase();
}

// ─── Issue Types ──────────────────────────────────────────────────────────────

export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  assignee: string;
  priority: string;
  type: string;
}

// ─── Issue Details (JSON) ─────────────────────────────────────────────────────

interface JiraRawIssue {
  key?: string;
  fields?: {
    summary?: string;
    status?: { name?: string };
    assignee?: { displayName?: string; name?: string };
    priority?: { name?: string };
    issueType?: { name?: string };
  };
}

function mapRawIssue(raw: JiraRawIssue, fallbackKey?: string): JiraIssue {
  const f = raw.fields ?? {};
  return {
    key: raw.key ?? fallbackKey ?? "",
    summary: f.summary ?? "",
    status: f.status?.name ?? "",
    assignee: f.assignee?.displayName ?? f.assignee?.name ?? "",
    priority: f.priority?.name ?? "",
    type: f.issueType?.name ?? "",
  };
}

export function openIssueInJira(ticketKey: string): void {
  const cli = getJiraCliPath();
  exec(`${cli} open ${ticketKey}`, { env: shellEnv() });
}

export async function getIssueDetails(ticketKey: string): Promise<JiraIssue> {
  const stdout = await runJira(`issue view ${ticketKey} --raw`);

  let parsed: JiraRawIssue;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(
      `Could not parse JSON from jira CLI output for ${ticketKey}.\n\nRaw output:\n${stdout.slice(0, 500)}`,
    );
  }

  const issue = mapRawIssue(parsed, ticketKey);
  if (!issue.status) {
    throw new Error(
      `Could not determine status for ${ticketKey}.\n\nRaw output:\n${stdout.slice(0, 500)}`,
    );
  }

  return issue;
}

// ─── Issue List (JSON) ────────────────────────────────────────────────────────

export async function getMyInProgressIssues(): Promise<JiraIssue[]> {
  const statuses = WORKFLOW.filter((s) => s.status !== "Done")
    .map((s) => `"${s.status}"`)
    .join(", ");

  // jira-cli wraps --jql in its own query, so ORDER BY must use the --order-by flag
  const jql = `assignee = currentUser() AND status in (${statuses})`;

  const stdout = await runJira(`issue list --jql '${jql}' --order-by updated --raw`);
  return parseIssueListJson(stdout);
}

function parseIssueListJson(output: string): JiraIssue[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return [];
  }

  // jira-cli --raw returns either an array directly or { issues: [...] }
  let items: JiraRawIssue[];
  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (parsed && typeof parsed === "object" && "issues" in parsed && Array.isArray((parsed as { issues: unknown }).issues)) {
    items = (parsed as { issues: JiraRawIssue[] }).issues;
  } else {
    return [];
  }

  return items.map((raw) => mapRawIssue(raw)).filter((i) => i.key && i.status);
}

// ─── Transitions ──────────────────────────────────────────────────────────────

export async function transitionIssue(ticketKey: string, targetStatus: string): Promise<void> {
  const stdout = await runJira(`issue move ${ticketKey} "${targetStatus}"`);

  if (/error|failed|invalid/i.test(stdout) && !/✓/.test(stdout)) {
    throw new Error(`Transition may have failed.\n\nCLI output:\n${stdout.slice(0, 400)}`);
  }
}

// ─── Dev Date Auto-fill ───────────────────────────────────────────────────────

export const DEV_DATE_FIELDS = {
  devStartDate: { name: "Dev Start Date", id: "customfield_11516" },
  devDueDate: { name: "Dev Due Date", id: "customfield_10304" },
  plannedStart: { name: "Planned Dev Start Date", id: "customfield_11520" },
  plannedDue: { name: "Planned Dev Due Date", id: "customfield_11509" },
};

export async function getIssueRawFields(
  ticketKey: string,
  fieldIds: string[],
): Promise<Record<string, string | null>> {
  const stdout = await runJira(`issue view ${ticketKey} --raw`);

  let parsed: { fields?: Record<string, unknown> };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(
      `Could not parse JSON from jira CLI output for ${ticketKey}.\n\nRaw output:\n${stdout.slice(0, 500)}`,
    );
  }

  const fields = parsed?.fields ?? {};

  const result: Record<string, string | null> = {};
  for (const id of fieldIds) {
    const val = fields[id];
    if (typeof val === "string") {
      result[id] = val;
    } else if (val && typeof val === "object" && "value" in (val as Record<string, unknown>) && typeof (val as Record<string, unknown>).value === "string") {
      result[id] = (val as Record<string, string>).value;
    } else {
      result[id] = null;
    }
  }
  return result;
}

// ─── Jira REST API (bypass broken jira-cli `issue edit --custom`) ─────────────

const FIELD_NAME_TO_ID: Record<string, string> = {
  [DEV_DATE_FIELDS.devStartDate.name]: DEV_DATE_FIELDS.devStartDate.id,
  [DEV_DATE_FIELDS.devDueDate.name]: DEV_DATE_FIELDS.devDueDate.id,
  [DEV_DATE_FIELDS.plannedStart.name]: DEV_DATE_FIELDS.plannedStart.id,
  [DEV_DATE_FIELDS.plannedDue.name]: DEV_DATE_FIELDS.plannedDue.id,
};

let cachedAuth: { server: string; token: string } | null = null;

async function getJiraAuth(): Promise<{ server: string; token: string }> {
  if (cachedAuth) return cachedAuth;

  const cli = getJiraCliPath();
  // `sprint list --debug` is lightweight and always prints HTTP request details
  const { stdout } = await execAsync(`${cli} sprint list --debug 2>&1`, {
    env: shellEnv(),
    maxBuffer: 10 * 1024 * 1024,
  });

  const tokenMatch = stdout.match(/Authorization: Bearer (\S+)/);
  const hostMatch = stdout.match(/Host: (\S+)/);
  if (!tokenMatch || !hostMatch) {
    throw new Error("Could not extract Jira auth from CLI debug output.");
  }

  cachedAuth = { server: `https://${hostMatch[1]}`, token: tokenMatch[1] };
  return cachedAuth;
}

let cachedFieldMap: Record<string, string> | null = null;

async function resolveFieldId(fieldName: string): Promise<string | null> {
  if (FIELD_NAME_TO_ID[fieldName]) return FIELD_NAME_TO_ID[fieldName];

  if (!cachedFieldMap) {
    try {
      const auth = await getJiraAuth();
      const { stdout } = await execFileAsync(
        "curl",
        ["-s", `${auth.server}/rest/api/2/field`, "-H", `Authorization: Bearer ${auth.token}`],
        { env: shellEnv(), maxBuffer: 10 * 1024 * 1024 },
      );
      const fields: Array<{ id: string; name: string }> = JSON.parse(stdout);
      cachedFieldMap = {};
      for (const f of fields) {
        cachedFieldMap[f.name] = f.id;
      }
    } catch {
      cachedFieldMap = {};
    }
  }

  return cachedFieldMap[fieldName] ?? null;
}

export async function setIssueCustomFields(
  ticketKey: string,
  fields: Record<string, string>,
): Promise<void> {
  const auth = await getJiraAuth();

  const fieldData: Record<string, string> = {};
  for (const [name, value] of Object.entries(fields)) {
    const id = await resolveFieldId(name);
    if (!id) throw new Error(`Could not resolve Jira field ID for "${name}".`);
    fieldData[id] = value;
  }

  const body = JSON.stringify({ fields: fieldData });
  const { stdout } = await execFileAsync(
    "curl",
    [
      "-s", "-w", "\n%{http_code}",
      "-X", "PUT",
      `${auth.server}/rest/api/2/issue/${ticketKey}`,
      "-H", `Authorization: Bearer ${auth.token}`,
      "-H", "Content-Type: application/json",
      "-d", body,
    ],
    { env: shellEnv(), maxBuffer: 10 * 1024 * 1024 },
  );

  const lines = stdout.trim().split("\n");
  const httpCode = lines[lines.length - 1].trim();
  if (!httpCode.startsWith("2")) {
    const responseBody = lines.slice(0, -1).join("\n");
    throw new Error(`Failed to update fields (HTTP ${httpCode}): ${responseBody.slice(0, 400)}`);
  }
}

/**
 * Auto-fill Dev Start/Due Date from their Planned counterparts.
 * Returns which fields were filled and which are still missing.
 */
export async function autoFillDevDates(
  ticketKey: string,
): Promise<{ filled: string[]; stillMissing: string[] }> {
  const allIds = [
    DEV_DATE_FIELDS.devStartDate.id,
    DEV_DATE_FIELDS.devDueDate.id,
    DEV_DATE_FIELDS.plannedStart.id,
    DEV_DATE_FIELDS.plannedDue.id,
  ];

  const raw = await getIssueRawFields(ticketKey, allIds);

  const toFill: Record<string, string> = {};
  const filled: string[] = [];
  const stillMissing: string[] = [];

  // Dev Start Date: fill from Planned Dev Start Date if missing
  if (!raw[DEV_DATE_FIELDS.devStartDate.id]) {
    const planned = raw[DEV_DATE_FIELDS.plannedStart.id];
    if (planned) {
      toFill[DEV_DATE_FIELDS.devStartDate.name] = planned;
      filled.push(DEV_DATE_FIELDS.devStartDate.name);
    } else {
      stillMissing.push(DEV_DATE_FIELDS.devStartDate.name);
    }
  }

  // Dev Due Date: fill from Planned Dev Due Date if missing
  if (!raw[DEV_DATE_FIELDS.devDueDate.id]) {
    const planned = raw[DEV_DATE_FIELDS.plannedDue.id];
    if (planned) {
      toFill[DEV_DATE_FIELDS.devDueDate.name] = planned;
      filled.push(DEV_DATE_FIELDS.devDueDate.name);
    } else {
      stillMissing.push(DEV_DATE_FIELDS.devDueDate.name);
    }
  }

  if (Object.keys(toFill).length > 0) {
    await setIssueCustomFields(ticketKey, toFill);
  }

  return { filled, stillMissing };
}

/**
 * Parse "please fill in X, Y" from a jira CLI error message.
 * Returns the list of missing field names, or empty array if not matched.
 */
export function parseMissingFieldsFromError(errorMsg: string): string[] {
  const match = errorMsg.match(/(?:please )?fill in (.+)/i);
  if (!match) return [];
  return match[1]
    .split(/[,;]|\band\b/i)
    .map((s) => s.trim().replace(/\.+$/, ""))
    .filter(Boolean);
}
