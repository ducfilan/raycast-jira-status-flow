import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { getPreferenceValues } from "@raycast/api";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// ─── Workflow Definitions ─────────────────────────────────────────────────────

export type WorkflowStatus =
  | "Waiting"
  | "TO DO"
  | "Req.Gathering"
  | "Feasibility Study"
  | "PRD"
  | "Tech Design"
  | "Doing"
  | "Developing"
  | "Integration"
  | "1ST REVIEW"
  | "Testing"
  | "2ND REVIEW"
  | "Reviewing"
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

export const TASK_WORKFLOW: WorkflowStep[] = [
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

export const EPIC_WORKFLOW: WorkflowStep[] = [
  { status: "Waiting", emoji: "📋", color: "#8B9EB0", description: "Waiting to be started" },
  { status: "Req.Gathering", emoji: "📝", color: "#A8DADC", description: "Requirements gathering" },
  { status: "Feasibility Study", emoji: "🔎", color: "#457B9D", description: "Feasibility analysis" },
  { status: "PRD", emoji: "📄", color: "#1D3557", description: "Product requirements document" },
  { status: "Tech Design", emoji: "🏗️", color: "#264653", description: "Technical design" },
  { status: "Developing", emoji: "💻", color: "#F4A261", description: "Actively in development" },
  { status: "Integration", emoji: "🔗", color: "#E9C46A", description: "Integrating with other services" },
  { status: "Testing", emoji: "🧪", color: "#4361EE", description: "QA / manual testing" },
  { status: "UAT", emoji: "✅", color: "#3A86FF", description: "User acceptance testing" },
  { status: "Staging", emoji: "🚀", color: "#FF6B6B", description: "Deployed to staging" },
  { status: "Regression", emoji: "🔄", color: "#FB8500", description: "Regression testing" },
  { status: "Delivering", emoji: "📦", color: "#6A4C93", description: "Delivering to production" },
  { status: "Done", emoji: "🎉", color: "#2DC653", description: "Completed" },
];

export const DOC_WORKFLOW: WorkflowStep[] = [
  { status: "TO DO", emoji: "📋", color: "#8B9EB0", description: "To be started" },
  { status: "Doing", emoji: "🔨", color: "#F4A261", description: "Actively working" },
  { status: "Reviewing", emoji: "👀", color: "#2A9D8F", description: "Under review" },
  { status: "Done", emoji: "🎉", color: "#2DC653", description: "Completed" },
];

/** Backward-compatible alias (defaults to Task workflow) */
export const WORKFLOW = TASK_WORKFLOW;

export function getWorkflowForType(issueType: string): WorkflowStep[] {
  const t = (issueType ?? "").trim().toUpperCase();
  if (t === "EPIC") return EPIC_WORKFLOW;
  if (t === "DOC" || t === "DOCUMENT" || t === "DOCUMENTATION") return DOC_WORKFLOW;
  return TASK_WORKFLOW;
}

export function isDocType(issueType: string): boolean {
  const t = (issueType ?? "").trim().toUpperCase();
  return t === "DOC" || t === "DOCUMENT" || t === "DOCUMENTATION";
}

const STATUS_ALIASES: Record<string, string> = {
  "TO DO": "WAITING",
};

const STATUS_FALLBACKS: Record<string, string[]> = {};
for (const [alias, canonical] of Object.entries(STATUS_ALIASES)) {
  if (!STATUS_FALLBACKS[canonical]) STATUS_FALLBACKS[canonical] = [];
  STATUS_FALLBACKS[canonical].push(alias);
}

export function normalizeStatus(status: string): string {
  const upper = status.trim().toUpperCase();
  return STATUS_ALIASES[upper] ?? upper;
}

/**
 * Merged ordered list of all unique non-Done statuses across all workflows.
 * Used by the status board to display sections in a logical order.
 */
export const ALL_BOARD_STATUSES: WorkflowStep[] = (() => {
  const ordered: WorkflowStep[] = [
    { status: "Waiting", emoji: "📋", color: "#8B9EB0", description: "Waiting to be started" },
    { status: "Req.Gathering", emoji: "📝", color: "#A8DADC", description: "Requirements gathering" },
    { status: "Feasibility Study", emoji: "🔎", color: "#457B9D", description: "Feasibility analysis" },
    { status: "PRD", emoji: "📄", color: "#1D3557", description: "Product requirements document" },
    { status: "Tech Design", emoji: "🏗️", color: "#264653", description: "Technical design" },
    { status: "Doing", emoji: "🔨", color: "#F4A261", description: "Actively in development" },
    { status: "Developing", emoji: "💻", color: "#F4A261", description: "Actively in development" },
    { status: "Integration", emoji: "🔗", color: "#E9C46A", description: "Integrating with other services" },
    { status: "1ST REVIEW", emoji: "👀", color: "#2A9D8F", description: "First code review" },
    { status: "Testing", emoji: "🧪", color: "#4361EE", description: "QA / manual testing" },
    { status: "2ND REVIEW", emoji: "🔍", color: "#7209B7", description: "Second code review" },
    { status: "Reviewing", emoji: "👀", color: "#2A9D8F", description: "Under review" },
    { status: "UAT", emoji: "✅", color: "#3A86FF", description: "User acceptance testing" },
    { status: "Staging", emoji: "🚀", color: "#FF6B6B", description: "Deployed to staging" },
    { status: "Regression", emoji: "🔄", color: "#FB8500", description: "Regression testing" },
    { status: "Delivering", emoji: "📦", color: "#6A4C93", description: "Delivering to production" },
  ];
  const seen = new Set<string>();
  return ordered.filter((step) => {
    const norm = normalizeStatus(step.status);
    if (seen.has(norm)) return false;
    seen.add(norm);
    return true;
  });
})();

export function getWorkflowStep(status: string, issueType?: string): WorkflowStep | undefined {
  const workflow = issueType ? getWorkflowForType(issueType) : TASK_WORKFLOW;
  const norm = normalizeStatus(status);
  return workflow.find((s) => normalizeStatus(s.status) === norm);
}

export function getWorkflowIndex(status: string, issueType?: string): number {
  const workflow = issueType ? getWorkflowForType(issueType) : TASK_WORKFLOW;
  const norm = normalizeStatus(status);
  return workflow.findIndex((s) => normalizeStatus(s.status) === norm);
}

export function getNextStatus(currentStatus: string, issueType?: string): WorkflowStep | null {
  const workflow = issueType ? getWorkflowForType(issueType) : TASK_WORKFLOW;
  const idx = getWorkflowIndex(currentStatus, issueType);
  if (idx === -1 || idx >= workflow.length - 1) return null;
  return workflow[idx + 1];
}

export function getPreviousStatus(currentStatus: string, issueType?: string): WorkflowStep | null {
  const idx = getWorkflowIndex(currentStatus, issueType);
  const workflow = issueType ? getWorkflowForType(issueType) : TASK_WORKFLOW;
  if (idx <= 0) return null;
  return workflow[idx - 1];
}

export function getRemainingSteps(currentStatus: string, issueType?: string): WorkflowStep[] {
  const workflow = issueType ? getWorkflowForType(issueType) : TASK_WORKFLOW;
  const idx = getWorkflowIndex(currentStatus, issueType);
  if (idx === -1) return [];
  return workflow.slice(idx + 1);
}

export function getTransitionPathToTarget(
  currentStatus: string,
  targetStatus: string,
  issueType?: string,
): WorkflowStep[] | null {
  const workflow = issueType ? getWorkflowForType(issueType) : TASK_WORKFLOW;
  const cur = getWorkflowIndex(currentStatus, issueType);
  const tgt = getWorkflowIndex(targetStatus, issueType);
  if (cur === -1 || tgt === -1) return null;
  if (cur === tgt) return [];
  const path: WorkflowStep[] = [];
  if (tgt > cur) {
    for (let i = cur + 1; i <= tgt; i++) {
      path.push(workflow[i]);
    }
  } else {
    for (let i = cur - 1; i >= tgt; i--) {
      path.push(workflow[i]);
    }
  }
  return path;
}

// ─── Jira CLI Helpers ─────────────────────────────────────────────────────────

interface Preferences {
  jiraCliPath: string;
  jiraProject: string;
  jiraServer: string;
  jiraApiToken: string;
  commonAssignees: string;
  qaAssignee: string;
  reviewerAssignee: string;
  developerAssignee: string;
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

export function getJiraIssueBrowseUrl(issueKey: string): string {
  const server = getPrefs().jiraServer.replace(/\/+$/, "");
  if (!server) {
    throw new Error("Jira Server URL must be set in preferences.");
  }
  return `${server}/browse/${issueKey}`;
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
    let msg = err instanceof Error ? err.message : String(err);
    // Strip the noisy "Command failed: ..." prefix that contains the full command string
    msg = msg.replace(/^Command failed: [^\n]+\n/, "");
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
    issuetype?: { name?: string };
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
    type: f.issuetype?.name ?? f.issueType?.name ?? "",
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
    throw new Error(`Could not determine status for ${ticketKey}.\n\nRaw output:\n${stdout.slice(0, 500)}`);
  }

  return issue;
}

// ─── Issue List (JSON) ────────────────────────────────────────────────────────

export type TicketScope = "my-tickets" | "assigned";

async function discoverDevFieldIds(): Promise<string[]> {
  try {
    const map = await fetchFieldMap();
    const ids: string[] = [];
    for (const [name, id] of Object.entries(map)) {
      const lower = name.toLowerCase();
      if (lower === "developer" || lower.includes("dev list")) {
        ids.push(id);
      }
    }
    return ids;
  } catch {
    return [];
  }
}

export async function getMyInProgressIssues(scope: TicketScope = "my-tickets"): Promise<JiraIssue[]> {
  let jql: string;

  if (scope === "assigned") {
    jql = `assignee = currentUser() AND resolution = Unresolved`;
  } else {
    const conditions = ["assignee = currentUser()"];
    const devFieldIds = await discoverDevFieldIds();
    for (const fieldId of devFieldIds) {
      const numericId = fieldId.replace("customfield_", "");
      conditions.push(`cf[${numericId}] = currentUser()`);
    }
    if (devFieldIds.length === 0) {
      conditions.push('"Developer" = currentUser()');
    }
    jql = `(${conditions.join(" OR ")}) AND resolution = Unresolved`;
  }

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
  } else if (
    parsed &&
    typeof parsed === "object" &&
    "issues" in parsed &&
    Array.isArray((parsed as { issues: unknown }).issues)
  ) {
    items = (parsed as { issues: JiraRawIssue[] }).issues;
  } else {
    return [];
  }

  return items.map((raw) => mapRawIssue(raw)).filter((i) => i.key && i.status);
}

// ─── Transitions ──────────────────────────────────────────────────────────────

function parseAvailableTransitions(errorMsg: string): string[] {
  const re = /Available states for issue [^:]+:\s*(.+)/i;
  const match = re.exec(errorMsg);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((s) => s.trim().replaceAll(/(?:^')|(?:'$)/g, ""))
    .filter(Boolean);
}

function findMatchingTransition(targetStatus: string, available: string[]): string | null {
  const target = targetStatus.toUpperCase();
  // Exact match
  const exact = available.find((t) => t.toUpperCase() === target);
  if (exact) return exact;
  // "Back to X" pattern
  const backTo = available.find((t) => t.toUpperCase() === `BACK TO ${target}`);
  if (backTo) return backTo;
  // Contains target as a suffix (e.g. "Return to Doing" matches "Doing")
  const suffix = available.find((t) => t.toUpperCase().endsWith(target) && t.toUpperCase() !== target);
  if (suffix) return suffix;
  return null;
}

async function tryMove(ticketKey: string, transitionName: string): Promise<void> {
  const stdout = await runJira(`issue move ${ticketKey} "${transitionName}"`);
  if (/error|failed|invalid/i.test(stdout) && !/✓/.test(stdout)) {
    throw new Error(`Transition may have failed.\n\nCLI output:\n${stdout.slice(0, 400)}`);
  }
}

async function tryFallbacks(ticketKey: string, fallbacks: string[]): Promise<boolean> {
  for (const fallback of fallbacks) {
    try {
      await tryMove(ticketKey, fallback);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

// ─── REST API Transitions ─────────────────────────────────────────────────────

interface TransitionFieldMeta {
  required: boolean;
  name: string;
  schema?: { type?: string };
}

interface JiraTransition {
  id: string;
  name: string;
  to?: { name?: string };
  fields?: Record<string, TransitionFieldMeta>;
}

async function getAvailableTransitionsRest(ticketKey: string): Promise<JiraTransition[]> {
  const auth = getJiraAuth();
  const { stdout } = await execFileAsync(
    "curl",
    [
      "-s",
      `${auth.server}/rest/api/2/issue/${ticketKey}/transitions?expand=transitions.fields`,
      "-H",
      `Authorization: Bearer ${auth.token}`,
    ],
    { env: shellEnv(), maxBuffer: 10 * 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout) as { transitions?: JiraTransition[] };
  return parsed.transitions ?? [];
}

function findTransitionByName(transitions: JiraTransition[], targetStatus: string): JiraTransition | null {
  const target = targetStatus.toUpperCase();
  const exact = transitions.find((t) => t.name.toUpperCase() === target);
  if (exact) return exact;
  const toName = transitions.find((t) => t.to?.name?.toUpperCase() === target);
  if (toName) return toName;
  const backTo = transitions.find((t) => t.name.toUpperCase() === `BACK TO ${target}`);
  if (backTo) return backTo;
  const suffix = transitions.find((t) => t.name.toUpperCase().endsWith(target) && t.name.toUpperCase() !== target);
  if (suffix) return suffix;
  return null;
}

/**
 * Find the Developer custom field ID using multiple strategies:
 * 1. Check transition screen metadata (any field with "developer" in the name)
 * 2. Fall back to /rest/api/2/field lookup (exact + case-insensitive)
 * 3. Fall back to searching ALL fields for "developer" substring
 */
async function findDeveloperFieldId(transition: JiraTransition): Promise<string | null> {
  if (transition.fields) {
    for (const [fieldId, meta] of Object.entries(transition.fields)) {
      if ((meta.name ?? "").toLowerCase().includes("developer")) {
        return fieldId;
      }
    }
  }

  const fromResolve = await resolveFieldId("Developer");
  if (fromResolve) return fromResolve;

  try {
    const map = await fetchFieldMap();
    const entry = Object.entries(map).find(([k]) => k.toLowerCase().includes("developer"));
    if (entry) return entry[1];
  } catch {
    /* field list unavailable */
  }

  return null;
}

async function resolveDeveloperUser(): Promise<JiraUser> {
  const prefs = getPrefs();
  const devEmail = prefs.developerAssignee?.trim();
  if (devEmail) {
    const users = await searchJiraUser(devEmail);
    if (users.length > 0) return users[0];
  }
  return getCurrentUser();
}

/**
 * Build fields to include when transitioning to Doing/Developing.
 * Uses transition metadata first, then field-list API as fallback.
 */
async function buildDoingFields(
  transition: JiraTransition,
): Promise<{ fields: Record<string, unknown>; descriptions: string[] }> {
  const fields: Record<string, unknown> = {};
  const descriptions: string[] = [];

  const devFieldId = await findDeveloperFieldId(transition);
  if (devFieldId) {
    const devUser = await resolveDeveloperUser();
    fields[devFieldId] = devUser.name ? { name: devUser.name } : { accountId: devUser.accountId };
    descriptions.push(`Developer → ${devUser.displayName}`);
  } else {
    throw new Error(
      'Could not find the "Developer" custom field ID. ' +
        "The transition screen requires it but it was not found in the transition metadata or the field list API. " +
        `Transition fields: ${JSON.stringify(transition.fields ? Object.keys(transition.fields) : "none")}`,
    );
  }

  const today = new Date().toISOString().split("T")[0];

  if (transition.fields) {
    for (const [fieldId, meta] of Object.entries(transition.fields)) {
      if (fields[fieldId]) continue;
      const nameLC = (meta.name ?? "").toLowerCase();
      if (
        meta.schema?.type === "date" ||
        nameLC.includes("start date") ||
        nameLC.includes("due date")
      ) {
        fields[fieldId] = today;
        descriptions.push(`${meta.name} → ${today}`);
      }
    }
  }

  fields[DEV_DATE_FIELDS.devStartDate.id] ??= today;
  if (!descriptions.some((d) => d.includes("Dev Start Date"))) {
    descriptions.push(`Dev Start Date → ${today}`);
  }

  return { fields, descriptions };
}

export interface TransitionResult {
  autoFilled: string[];
}

async function transitionViaRest(
  ticketKey: string,
  targetStatus: string,
): Promise<TransitionResult> {
  const transitions = await getAvailableTransitionsRest(ticketKey);
  const match = findTransitionByName(transitions, targetStatus);

  const fallbackNames = STATUS_FALLBACKS[targetStatus.toUpperCase()] ?? [];
  const fallbackMatch = !match
    ? fallbackNames.reduce<JiraTransition | null>(
        (found, fb) => found ?? findTransitionByName(transitions, fb),
        null,
      )
    : null;

  const transition = match ?? fallbackMatch;
  if (!transition) {
    const available = transitions.map((t) => t.name).join(", ");
    throw new Error(`No matching transition to "${targetStatus}" for ${ticketKey}. Available: ${available}`);
  }

  let descriptions: string[] = [];
  let mergedFields: Record<string, unknown> = {};

  if (isDoingStatus(targetStatus)) {
    const result = await buildDoingFields(transition);
    mergedFields = result.fields;
    descriptions = result.descriptions;
  }

  const auth = getJiraAuth();
  const body: Record<string, unknown> = { transition: { id: transition.id } };
  if (Object.keys(mergedFields).length > 0) {
    body.fields = mergedFields;
  }

  const { stdout } = await execFileAsync(
    "curl",
    [
      "-s",
      "-w",
      "\n%{http_code}",
      "-X",
      "POST",
      `${auth.server}/rest/api/2/issue/${ticketKey}/transitions`,
      "-H",
      `Authorization: Bearer ${auth.token}`,
      "-H",
      "Content-Type: application/json",
      "-d",
      JSON.stringify(body),
    ],
    { env: shellEnv(), maxBuffer: 10 * 1024 * 1024 },
  );

  const lines = stdout.trim().split("\n");
  const httpCode = lines[lines.length - 1].trim();
  if (!httpCode.startsWith("2")) {
    const responseBody = lines.slice(0, -1).join("\n");
    throw new Error(`Transition to "${targetStatus}" failed (HTTP ${httpCode}): ${responseBody.slice(0, 400)}`);
  }

  return { autoFilled: descriptions };
}

export async function transitionIssue(ticketKey: string, targetStatus: string): Promise<TransitionResult> {
  if (isDoingStatus(targetStatus)) {
    return transitionViaRest(ticketKey, targetStatus);
  }

  const fallbacks = STATUS_FALLBACKS[targetStatus.toUpperCase()] ?? [];

  try {
    await tryMove(ticketKey, targetStatus);
  } catch (primaryError) {
    const errMsg = primaryError instanceof Error ? primaryError.message : String(primaryError);

    if (/custom field value must be set/i.test(errMsg)) {
      return transitionViaRest(ticketKey, targetStatus);
    }

    const available = parseAvailableTransitions(errMsg);
    const matchName = findMatchingTransition(targetStatus, available);

    if (matchName) {
      await tryMove(ticketKey, matchName);
      return { autoFilled: [] };
    }

    if (await tryFallbacks(ticketKey, fallbacks)) return { autoFilled: [] };

    throw primaryError;
  }

  return { autoFilled: [] };
}

// ─── Dev Date Auto-fill ───────────────────────────────────────────────────────

export const DEV_DATE_FIELDS = {
  devStartDate: { name: "Dev Start Date", id: "customfield_11516" },
  devDueDate: { name: "Dev Due Date", id: "customfield_10304" },
  plannedStart: { name: "Planned Dev Start Date", id: "customfield_11520" },
  plannedDue: { name: "Planned Dev Due Date", id: "customfield_11509" },
};

export async function getIssueRawFields(ticketKey: string, fieldIds: string[]): Promise<Record<string, string | null>> {
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
    } else if (
      val &&
      typeof val === "object" &&
      "value" in (val as Record<string, unknown>) &&
      typeof (val as Record<string, unknown>).value === "string"
    ) {
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

function getJiraAuth(): { server: string; token: string } {
  const prefs = getPrefs();
  const server = prefs.jiraServer.replace(/\/+$/, "");
  const token = prefs.jiraApiToken;
  if (!server || !token) {
    throw new Error("Jira Server URL and API Token must be set in preferences.");
  }
  return { server, token };
}

let cachedFieldMap: Record<string, string> | null = null;

async function fetchFieldMap(): Promise<Record<string, string>> {
  if (cachedFieldMap) return cachedFieldMap;

  const auth = getJiraAuth();
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
  return cachedFieldMap;
}

async function resolveFieldId(fieldName: string): Promise<string | null> {
  if (FIELD_NAME_TO_ID[fieldName]) return FIELD_NAME_TO_ID[fieldName];

  try {
    const map = await fetchFieldMap();
    if (map[fieldName]) return map[fieldName];

    const lower = fieldName.toLowerCase();
    const match = Object.entries(map).find(([k]) => k.toLowerCase() === lower);
    if (match) return match[1];
  } catch {
    cachedFieldMap = null;
  }

  return null;
}

async function setIssueFieldsRaw(ticketKey: string, fieldData: Record<string, unknown>): Promise<void> {
  const auth = getJiraAuth();
  const body = JSON.stringify({ fields: fieldData });
  const { stdout } = await execFileAsync(
    "curl",
    [
      "-s",
      "-w",
      "\n%{http_code}",
      "-X",
      "PUT",
      `${auth.server}/rest/api/2/issue/${ticketKey}`,
      "-H",
      `Authorization: Bearer ${auth.token}`,
      "-H",
      "Content-Type: application/json",
      "-d",
      body,
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

export async function setIssueCustomFields(ticketKey: string, fields: Record<string, string>): Promise<void> {
  const auth = getJiraAuth();

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
      "-s",
      "-w",
      "\n%{http_code}",
      "-X",
      "PUT",
      `${auth.server}/rest/api/2/issue/${ticketKey}`,
      "-H",
      `Authorization: Bearer ${auth.token}`,
      "-H",
      "Content-Type: application/json",
      "-d",
      body,
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
export async function autoFillDevDates(ticketKey: string): Promise<{ filled: string[]; stillMissing: string[] }> {
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

// ─── Doing-status Helper ──────────────────────────────────────────────────────

export function isDoingStatus(status: string): boolean {
  const norm = normalizeStatus(status);
  return norm === "DOING" || norm === "DEVELOPING";
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

// ─── Assignee Helpers ─────────────────────────────────────────────────────────

export function getCommonAssignees(): string[] {
  const raw = getPrefs().commonAssignees || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const ROLE_STATUS_MAP: Record<string, "qa" | "reviewer"> = {
  TESTING: "qa",
  "1ST REVIEW": "reviewer",
  "2ND REVIEW": "reviewer",
  REVIEWING: "reviewer",
};

const ROLE_FIELD_NAMES: Record<"qa" | "reviewer", string> = {
  qa: "QA",
  reviewer: "Development Reviewer",
};

export function getRoleAssignee(role: "qa" | "reviewer"): string {
  const prefs = getPrefs();
  return (role === "qa" ? prefs.qaAssignee : prefs.reviewerAssignee)?.trim() || "";
}

async function getIssueFieldUser(ticketKey: string, fieldName: string): Promise<JiraUser | null> {
  const fieldId = await resolveFieldId(fieldName);
  if (!fieldId) return null;

  const stdout = await runJira(`issue view ${ticketKey} --raw`);
  let parsed: { fields?: Record<string, unknown> };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }

  const val = parsed?.fields?.[fieldId];
  if (!val || typeof val !== "object") return null;

  const user = val as Record<string, unknown>;
  if (!user.accountId && !user.name && !user.key) return null;

  return {
    accountId: typeof user.accountId === "string" ? user.accountId : undefined,
    name: typeof user.name === "string" ? user.name : typeof user.key === "string" ? (user.key as string) : undefined,
    displayName:
      (typeof user.displayName === "string" ? user.displayName : undefined) ??
      (typeof user.name === "string" ? user.name : undefined) ??
      (typeof user.accountId === "string" ? user.accountId : ""),
    emailAddress: typeof user.emailAddress === "string" ? user.emailAddress : undefined,
  };
}

/**
 * If the target status has a configured role assignee (QA for Testing,
 * Reviewer for reviews), look up and assign that person.
 * Checks the issue's custom field first (e.g. "QA", "Development Reviewer"),
 * then falls back to the preference value.
 */
export async function autoAssignForStatus(
  ticketKey: string,
  targetStatus: string,
): Promise<{ assigned: boolean; displayName?: string }> {
  const role = ROLE_STATUS_MAP[normalizeStatus(targetStatus)];
  if (!role) return { assigned: false };

  const fieldUser = await getIssueFieldUser(ticketKey, ROLE_FIELD_NAMES[role]);
  if (fieldUser) {
    await assignIssue(ticketKey, fieldUser);
    return { assigned: true, displayName: fieldUser.displayName };
  }

  const email = getRoleAssignee(role);
  if (!email) return { assigned: false };

  const users = await searchJiraUser(email);
  if (users.length === 0) return { assigned: false };

  await assignIssue(ticketKey, users[0]);
  return { assigned: true, displayName: users[0].displayName };
}

export interface JiraUser {
  accountId?: string;
  name?: string;
  displayName: string;
  emailAddress?: string;
}

async function fetchJiraUsers(url: string, token: string): Promise<JiraUser[]> {
  const { stdout } = await execFileAsync("curl", ["-s", url, "-H", `Authorization: Bearer ${token}`], {
    env: shellEnv(),
    maxBuffer: 10 * 1024 * 1024,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];
  return (
    parsed as Array<{ accountId?: string; name?: string; key?: string; displayName?: string; emailAddress?: string }>
  )
    .filter((u) => u.accountId || u.name || u.key)
    .map((u) => ({
      accountId: u.accountId,
      name: u.name ?? u.key,
      displayName: u.displayName ?? u.name ?? u.accountId ?? "",
      emailAddress: u.emailAddress,
    }));
}

export async function getCurrentUser(): Promise<JiraUser> {
  const auth = getJiraAuth();
  const { stdout } = await execFileAsync(
    "curl",
    ["-s", `${auth.server}/rest/api/2/myself`, "-H", `Authorization: Bearer ${auth.token}`],
    { env: shellEnv(), maxBuffer: 10 * 1024 * 1024 },
  );

  const u = JSON.parse(stdout) as {
    accountId?: string;
    name?: string;
    key?: string;
    displayName?: string;
    emailAddress?: string;
  };
  return {
    accountId: u.accountId,
    name: u.name ?? u.key,
    displayName: u.displayName ?? u.name ?? u.accountId ?? "me",
    emailAddress: u.emailAddress,
  };
}

export async function searchJiraUser(query: string): Promise<JiraUser[]> {
  const auth = getJiraAuth();
  const encoded = encodeURIComponent(query);

  // Jira Server uses `username`, Jira Cloud uses `query`
  const serverResults = await fetchJiraUsers(
    `${auth.server}/rest/api/2/user/search?username=${encoded}&maxResults=10`,
    auth.token,
  );
  if (serverResults.length > 0) return serverResults;

  return fetchJiraUsers(`${auth.server}/rest/api/2/user/search?query=${encoded}&maxResults=10`, auth.token);
}

export async function assignIssue(ticketKey: string, user: JiraUser): Promise<void> {
  const auth = getJiraAuth();
  const body = JSON.stringify(user.name ? { name: user.name } : { accountId: user.accountId });
  const { stdout } = await execFileAsync(
    "curl",
    [
      "-s",
      "-w",
      "\n%{http_code}",
      "-X",
      "PUT",
      `${auth.server}/rest/api/2/issue/${ticketKey}/assignee`,
      "-H",
      `Authorization: Bearer ${auth.token}`,
      "-H",
      "Content-Type: application/json",
      "-d",
      body,
    ],
    { env: shellEnv(), maxBuffer: 10 * 1024 * 1024 },
  );

  const lines = stdout.trim().split("\n");
  const httpCode = lines[lines.length - 1].trim();
  if (!httpCode.startsWith("2")) {
    const responseBody = lines.slice(0, -1).join("\n");
    throw new Error(`Failed to assign issue (HTTP ${httpCode}): ${responseBody.slice(0, 400)}`);
  }
}
