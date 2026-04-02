import {
  ActionPanel,
  Action,
  List,
  showToast,
  Toast,
  Color,
  Icon,
  openExtensionPreferences,
  useNavigation,
} from "@raycast/api";
import { useEffect, useState, useCallback } from "react";
import {
  getMyInProgressIssues,
  transitionIssue,
  getNextStatus,
  getPreviousStatus,
  getRemainingSteps,
  normalizeStatus,
  autoFillDevDates,
  parseMissingFieldsFromError,
  openIssueInJira,
  searchJiraUser,
  assignIssue,
  getCommonAssignees,
  getCurrentUser,
  autoAssignForStatus,
  isDocType,
  ALL_BOARD_STATUSES,
  DEV_DATE_FIELDS,
  setIssueCustomFields,
  getIssueRawFields,
  type JiraIssue,
  type JiraUser,
  type TicketScope,
} from "./utils";
import MissingFieldsForm from "./missing-fields-form";

const STATUS_COLORS: Record<string, Color> = {
  WAITING: Color.SecondaryText,
  "TO DO": Color.SecondaryText,
  "REQ.GATHERING": Color.Blue,
  "FEASIBILITY STUDY": Color.Blue,
  PRD: Color.Purple,
  "TECH DESIGN": Color.Purple,
  DOING: Color.Orange,
  DEVELOPING: Color.Orange,
  INTEGRATION: Color.Yellow,
  "1ST REVIEW": Color.Green,
  TESTING: Color.Blue,
  "2ND REVIEW": Color.Purple,
  REVIEWING: Color.Green,
  UAT: Color.Blue,
  STAGING: Color.Red,
  REGRESSION: Color.Orange,
  DELIVERING: Color.Purple,
  DONE: Color.Green,
};

function AssigneeForm({ issueKey, onAssigned }: { issueKey: string; onAssigned: (assigneeName: string) => void }) {
  const { pop } = useNavigation();
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<JiraUser[]>([]);
  const [searching, setSearching] = useState(false);
  const commonAssignees = getCommonAssignees();

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setUsers([]);
      return;
    }
    setSearching(true);
    try {
      const results = await searchJiraUser(q);
      setUsers(results);
    } catch {
      setUsers([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => doSearch(query), 400);
    return () => clearTimeout(timer);
  }, [query, doSearch]);

  async function handleAssign(user: JiraUser) {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: `Assigning ${issueKey}`,
      message: user.displayName,
    });
    try {
      await assignIssue(issueKey, user);
      toast.style = Toast.Style.Success;
      toast.title = `${issueKey} assigned`;
      toast.message = user.displayName;
      onAssigned(user.displayName);
      pop();
    } catch (e: unknown) {
      toast.style = Toast.Style.Failure;
      toast.title = "Assign failed";
      toast.message = e instanceof Error ? e.message : String(e);
    }
  }

  async function handleQuickAssign(email: string) {
    const toast = await showToast({ style: Toast.Style.Animated, title: "Looking up user…", message: email });
    try {
      const results = await searchJiraUser(email);
      if (results.length === 0) {
        toast.style = Toast.Style.Failure;
        toast.title = "User not found";
        toast.message = email;
        return;
      }
      toast.hide();
      await handleAssign(results[0]);
    } catch (e: unknown) {
      toast.style = Toast.Style.Failure;
      toast.title = "Lookup failed";
      toast.message = e instanceof Error ? e.message : String(e);
    }
  }

  async function handleAssignMe() {
    const toast = await showToast({ style: Toast.Style.Animated, title: "Looking up current user…" });
    try {
      const me = await getCurrentUser();
      toast.hide();
      await handleAssign(me);
    } catch (e: unknown) {
      toast.style = Toast.Style.Failure;
      toast.title = "Failed to get current user";
      toast.message = e instanceof Error ? e.message : String(e);
    }
  }

  return (
    <List
      isLoading={searching}
      searchText={query}
      onSearchTextChange={setQuery}
      searchBarPlaceholder="Search assignee by name or email…"
      throttle
    >
      {query.trim() === "" && (
        <List.Section title="Quick Assign">
          <List.Item
            key="__me__"
            title="Myself"
            icon={Icon.PersonCircle}
            actions={
              <ActionPanel>
                <Action title="Assign to Myself" onAction={handleAssignMe} />
              </ActionPanel>
            }
          />
          {commonAssignees.map((email) => (
            <List.Item
              key={email}
              title={email}
              icon={Icon.Person}
              actions={
                <ActionPanel>
                  <Action title={`Assign to ${email}`} onAction={() => handleQuickAssign(email)} />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}

      {users.length > 0 && (
        <List.Section title="Search Results">
          {users.map((u) => (
            <List.Item
              key={u.accountId ?? u.name ?? u.displayName}
              title={u.displayName}
              subtitle={u.emailAddress}
              icon={Icon.Person}
              actions={
                <ActionPanel>
                  <Action title={`Assign to ${u.displayName}`} onAction={() => handleAssign(u)} />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}

      {query.trim() !== "" && users.length === 0 && !searching && (
        <List.EmptyView title="No users found" description={`No results for "${query}"`} />
      )}
    </List>
  );
}

type DatePreset = { label: string; getDate: () => string };

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function nextWeekday(dayOfWeek: number): Date {
  const d = new Date();
  const diff = (dayOfWeek - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

const DATE_PRESETS: DatePreset[] = [
  { label: "Today", getDate: () => formatDate(new Date()) },
  { label: "Tomorrow", getDate: () => formatDate(addDays(1)) },
  { label: "Next Monday", getDate: () => formatDate(nextWeekday(1)) },
  { label: "Next Friday", getDate: () => formatDate(nextWeekday(5)) },
  { label: "In 1 Week", getDate: () => formatDate(addDays(7)) },
  { label: "In 2 Weeks", getDate: () => formatDate(addDays(14)) },
  { label: "In 1 Month", getDate: () => formatDate(addDays(30)) },
];

type DevDateField = "devStartDate" | "devDueDate";

function DevDatesForm({
  issueKey,
  onUpdated,
}: {
  issueKey: string;
  onUpdated: () => void;
}) {
  const [currentDates, setCurrentDates] = useState<Record<string, string | null>>({});
  const [loadingDates, setLoadingDates] = useState(true);
  const [selectedField, setSelectedField] = useState<DevDateField | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const raw = await getIssueRawFields(issueKey, [
          DEV_DATE_FIELDS.devStartDate.id,
          DEV_DATE_FIELDS.devDueDate.id,
        ]);
        setCurrentDates(raw);
      } catch {
        /* best-effort */
      } finally {
        setLoadingDates(false);
      }
    })();
  }, [issueKey]);

  async function handleSetDate(field: DevDateField, date: string) {
    const fieldDef = DEV_DATE_FIELDS[field];
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: `Setting ${fieldDef.name}`,
      message: `${issueKey} → ${date}`,
    });
    try {
      await setIssueCustomFields(issueKey, { [fieldDef.name]: date });
      toast.style = Toast.Style.Success;
      toast.title = `${fieldDef.name} updated`;
      toast.message = `${issueKey}: ${date}`;
      setCurrentDates((prev) => ({ ...prev, [fieldDef.id]: date }));
      setSelectedField(null);
      onUpdated();
    } catch (e: unknown) {
      toast.style = Toast.Style.Failure;
      toast.title = "Failed to update date";
      toast.message = e instanceof Error ? e.message : String(e);
    }
  }

  const fields: { key: DevDateField; name: string; id: string }[] = [
    { key: "devStartDate", name: DEV_DATE_FIELDS.devStartDate.name, id: DEV_DATE_FIELDS.devStartDate.id },
    { key: "devDueDate", name: DEV_DATE_FIELDS.devDueDate.name, id: DEV_DATE_FIELDS.devDueDate.id },
  ];

  if (selectedField) {
    const fieldDef = DEV_DATE_FIELDS[selectedField];
    const currentValue = currentDates[fieldDef.id];
    return (
      <List
        isLoading={loadingDates}
        navigationTitle={`${issueKey} — ${fieldDef.name}`}
        searchBarPlaceholder={`Pick a date for ${fieldDef.name}…`}
      >
        {currentValue && (
          <List.Section title="Current Value">
            <List.Item
              title={currentValue}
              icon={Icon.Calendar}
              accessories={[{ tag: "current" }]}
            />
          </List.Section>
        )}
        <List.Section title="Quick Dates">
          {DATE_PRESETS.map((preset) => {
            const date = preset.getDate();
            return (
              <List.Item
                key={preset.label}
                title={preset.label}
                subtitle={date}
                icon={Icon.Clock}
                actions={
                  <ActionPanel>
                    <Action
                      title={`Set to ${preset.label} (${date})`}
                      onAction={() => handleSetDate(selectedField, date)}
                    />
                    <Action title="Back" onAction={() => setSelectedField(null)} shortcut={{ modifiers: ["cmd"], key: "backspace" }} />
                  </ActionPanel>
                }
              />
            );
          })}
        </List.Section>
      </List>
    );
  }

  return (
    <List
      isLoading={loadingDates}
      navigationTitle={`${issueKey} — Dev Dates`}
      searchBarPlaceholder="Choose a date field to update…"
    >
      {fields.map((f) => {
        const currentValue = currentDates[f.id];
        return (
          <List.Item
            key={f.key}
            title={f.name}
            subtitle={currentValue ?? "Not set"}
            icon={Icon.Calendar}
            accessories={currentValue ? [{ tag: currentValue }] : [{ tag: { value: "empty", color: Color.SecondaryText } }]}
            actions={
              <ActionPanel>
                <Action title={`Change ${f.name}`} onAction={() => setSelectedField(f.key)} />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}

export default function WorkflowStatusBoard() {
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [scope, setScope] = useState<TicketScope>("my-tickets");
  const { push } = useNavigation();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fetched = await getMyInProgressIssues(scope);
      setIssues(fetched);
    } catch (e: unknown) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to fetch issues",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleTransitionError(issueKey: string, error: unknown, retryFn: () => Promise<void>) {
    const msg = error instanceof Error ? error.message : String(error);
    const missingFields = parseMissingFieldsFromError(msg);
    if (missingFields.length > 0) {
      push(<MissingFieldsForm issueKey={issueKey} missingFields={missingFields} onComplete={retryFn} />);
    } else {
      await showToast({ style: Toast.Style.Failure, title: "Transition failed", message: msg });
    }
  }

  async function ensureDevDatesAndRun(issueKey: string, action: () => Promise<void>) {
    const toast = await showToast({ style: Toast.Style.Animated, title: "Checking required fields…" });
    try {
      const { filled, stillMissing } = await autoFillDevDates(issueKey);
      if (filled.length > 0) {
        toast.title = "Auto-filled dates";
        toast.message = filled.join(", ");
      }
      toast.hide();

      if (stillMissing.length > 0) {
        push(<MissingFieldsForm issueKey={issueKey} missingFields={stillMissing} onComplete={action} />);
      } else {
        await action();
      }
    } catch (e: unknown) {
      toast.style = Toast.Style.Failure;
      toast.title = "Auto-fill failed, continuing…";
      toast.message = e instanceof Error ? e.message : String(e);
      await action();
    }
  }

  async function advanceIssue(issue: JiraIssue) {
    const next = getNextStatus(issue.status, issue.type);
    if (!next) return;

    const doTransition = async () => {
      const toast = await showToast({
        style: Toast.Style.Animated,
        title: `Advancing ${issue.key}`,
        message: `${issue.status} → ${next.status}`,
      });

      try {
        await transitionIssue(issue.key, next.status);
        setIssues((prev) => prev.map((i) => (i.key === issue.key ? { ...i, status: next.status } : i)));
        toast.style = Toast.Style.Success;
        toast.title = `${issue.key} advanced`;
        toast.message = `${next.emoji} ${next.status}`;

        try {
          const result = await autoAssignForStatus(issue.key, next.status);
          if (result.assigned) {
            setIssues((prev) =>
              prev.map((i) => (i.key === issue.key ? { ...i, assignee: result.displayName ?? "" } : i)),
            );
            toast.message = `${next.emoji} ${next.status} → ${result.displayName}`;
          }
        } catch {
          /* auto-assign is best-effort */
        }
      } catch (e: unknown) {
        toast.style = Toast.Style.Failure;
        toast.title = "Transition failed";
        await handleTransitionError(issue.key, e, doTransition);
      }
    };

    if (next.status === "Done" && !isDocType(issue.type)) {
      await ensureDevDatesAndRun(issue.key, doTransition);
    } else {
      await doTransition();
    }
  }

  async function regressIssue(issue: JiraIssue) {
    const prev = getPreviousStatus(issue.status, issue.type);
    if (!prev) return;

    const toast = await showToast({
      style: Toast.Style.Animated,
      title: `Moving ${issue.key} back`,
      message: `${issue.status} → ${prev.status}`,
    });

    try {
      await transitionIssue(issue.key, prev.status);
      setIssues((prev_) => prev_.map((i) => (i.key === issue.key ? { ...i, status: prev.status } : i)));
      toast.style = Toast.Style.Success;
      toast.title = `${issue.key} moved back`;
      toast.message = `${prev.emoji} ${prev.status}`;

      try {
        const result = await autoAssignForStatus(issue.key, prev.status);
        if (result.assigned) {
          setIssues((prev_) =>
            prev_.map((i) => (i.key === issue.key ? { ...i, assignee: result.displayName ?? "" } : i)),
          );
          toast.message = `${prev.emoji} ${prev.status} → ${result.displayName}`;
        }
      } catch {
        /* auto-assign is best-effort */
      }
    } catch (e: unknown) {
      toast.style = Toast.Style.Failure;
      toast.title = "Transition failed";
      await handleTransitionError(issue.key, e, () => regressIssue(issue));
    }
  }

  async function moveToDone(issue: JiraIssue) {
    const remaining = getRemainingSteps(issue.status, issue.type);
    if (remaining.length === 0) return;

    const doTransitions = async () => {
      const toast = await showToast({
        style: Toast.Style.Animated,
        title: `Moving ${issue.key} to Done`,
        message: `${remaining.length} transitions…`,
      });

      let current = issue.status;
      for (const step of remaining) {
        try {
          await transitionIssue(issue.key, step.status);
          current = step.status;
          try {
            await autoAssignForStatus(issue.key, step.status);
          } catch {
            /* best-effort */
          }
          await new Promise((r) => setTimeout(r, 600));
        } catch (e: unknown) {
          toast.style = Toast.Style.Failure;
          toast.title = `Failed at ${step.status}`;
          setIssues((prev) => prev.map((i) => (i.key === issue.key ? { ...i, status: current } : i)));

          const msg = e instanceof Error ? e.message : String(e);
          const missingFields = parseMissingFieldsFromError(msg);
          if (missingFields.length > 0) {
            toast.hide();
            push(
              <MissingFieldsForm
                issueKey={issue.key}
                missingFields={missingFields}
                onComplete={() => moveToDone({ ...issue, status: current })}
              />,
            );
          } else {
            toast.message = msg;
          }
          return;
        }
      }

      setIssues((prev) => prev.filter((i) => i.key !== issue.key));
      toast.style = Toast.Style.Success;
      toast.title = `${issue.key} is Done!`;
      toast.message = "Removed from board";
    };

    if (isDocType(issue.type)) {
      await doTransitions();
    } else {
      await ensureDevDatesAndRun(issue.key, doTransitions);
    }
  }

  const boardStatuses = ALL_BOARD_STATUSES;
  const boardStatusNames = boardStatuses.map((s) => s.status);

  const grouped = boardStatusNames.reduce<Record<string, JiraIssue[]>>((acc, status) => {
    acc[status] = issues.filter((i) => normalizeStatus(i.status) === normalizeStatus(status));
    return acc;
  }, {});

  const sectionedStatuses = boardStatusNames.filter(
    (s) => filter === "all" || s.toUpperCase() === filter.toUpperCase(),
  );

  function handleDropdownChange(value: string) {
    if (value.startsWith("scope:")) {
      setScope(value.replace("scope:", "") as TicketScope);
    } else {
      setFilter(value);
    }
  }

  return (
    <List
      isLoading={loading}
      navigationTitle={scope === "my-tickets" ? "My Tickets" : "Assigned to Me"}
      searchBarPlaceholder={scope === "my-tickets" ? "Search my tickets (Developer/Dev List)…" : "Search assigned tickets…"}
      searchBarAccessory={
        <List.Dropdown tooltip="Scope & Status" onChange={handleDropdownChange}>
          <List.Dropdown.Section title="Ticket Scope">
            <List.Dropdown.Item title="👤 My Tickets (Developer/Dev List)" value="scope:my-tickets" />
            <List.Dropdown.Item title="📌 Assigned to Me Only" value="scope:assigned" />
          </List.Dropdown.Section>
          <List.Dropdown.Section title="Status Filter">
            <List.Dropdown.Item title="All In-Progress" value="all" />
            {boardStatuses.map((step) => (
              <List.Dropdown.Item key={step.status} title={`${step.emoji} ${step.status}`} value={step.status} />
            ))}
          </List.Dropdown.Section>
        </List.Dropdown>
      }
      actions={
        <ActionPanel>
          <Action title="Refresh" onAction={load} shortcut={{ modifiers: ["cmd"], key: "r" }} />
        </ActionPanel>
      }
    >
      {issues.length === 0 && !loading && (
        <List.EmptyView title="No in-progress tickets" description="All caught up!" icon="🎉" />
      )}

      {sectionedStatuses.map((statusName) => {
        const sectionIssues = grouped[statusName] || [];
        if (filter === "all" && sectionIssues.length === 0) return null;

        const step = boardStatuses.find((s) => s.status === statusName)!;

        return (
          <List.Section
            key={statusName}
            title={`${step.emoji} ${statusName}`}
            subtitle={`${sectionIssues.length} ticket${sectionIssues.length !== 1 ? "s" : ""}`}
          >
            {sectionIssues.map((issue) => {
              const next = getNextStatus(issue.status, issue.type);
              const remaining = getRemainingSteps(issue.status, issue.type).length;
              const color =
                STATUS_COLORS[normalizeStatus(issue.status)] ??
                STATUS_COLORS[issue.status.toUpperCase()] ??
                Color.PrimaryText;

              const prev = getPreviousStatus(issue.status, issue.type);

              return (
                <List.Item
                  key={issue.key}
                  title={issue.key}
                  subtitle={issue.summary || ""}
                  icon={{ source: Icon.Circle, tintColor: color }}
                  accessories={[
                    next
                      ? { text: `→ ${next.status}`, tooltip: `${remaining} step${remaining !== 1 ? "s" : ""} to Done` }
                      : { text: "✓ Done" },
                    issue.assignee ? { text: issue.assignee } : {},
                    issue.priority ? { tag: { value: issue.priority } } : {},
                  ]}
                  actions={
                    <ActionPanel>
                      <ActionPanel.Section title="Transition">
                        {next && (
                          <Action
                            title={`Advance to ${next.emoji} ${next.status}`}
                            shortcut={{ modifiers: ["cmd"], key: "return" }}
                            onAction={() => advanceIssue(issue)}
                          />
                        )}
                        {prev && (
                          <Action
                            title={`Move Back to ${prev.emoji} ${prev.status}`}
                            shortcut={{ modifiers: ["cmd"], key: "backspace" }}
                            onAction={() => regressIssue(issue)}
                          />
                        )}
                        {remaining > 0 && (
                          <Action
                            title={`Move to Done (${remaining} step${remaining !== 1 ? "s" : ""})`}
                            shortcut={{ modifiers: ["cmd", "shift"], key: "return" }}
                            onAction={() => moveToDone(issue)}
                          />
                        )}
                      </ActionPanel.Section>
                      <ActionPanel.Section title="Info">
                        <Action
                          title="Assign Ticket"
                          icon={Icon.AddPerson}
                          shortcut={{ modifiers: ["cmd", "shift"], key: "a" }}
                          onAction={() =>
                            push(
                              <AssigneeForm
                                issueKey={issue.key}
                                onAssigned={(name) =>
                                  setIssues((prev) =>
                                    prev.map((i) => (i.key === issue.key ? { ...i, assignee: name } : i)),
                                  )
                                }
                              />,
                            )
                          }
                        />
                        <Action
                          title="Change Dev Dates"
                          icon={Icon.Calendar}
                          shortcut={{ modifiers: ["cmd"], key: "d" }}
                          onAction={() =>
                            push(
                              <DevDatesForm
                                issueKey={issue.key}
                                onUpdated={load}
                              />,
                            )
                          }
                        />
                        <Action
                          title="Open in Jira"
                          shortcut={{ modifiers: ["cmd"], key: "o" }}
                          onAction={() => openIssueInJira(issue.key)}
                        />
                        <Action.CopyToClipboard
                          title="Copy Ticket Key"
                          content={issue.key}
                          shortcut={{ modifiers: ["cmd"], key: "c" }}
                        />
                        <Action.CopyToClipboard title="Copy Summary" content={issue.summary} />
                      </ActionPanel.Section>
                      <ActionPanel.Section>
                        <Action title="Refresh Board" onAction={load} shortcut={{ modifiers: ["cmd"], key: "r" }} />
                        <Action title="Open Preferences" onAction={openExtensionPreferences} />
                      </ActionPanel.Section>
                    </ActionPanel>
                  }
                />
              );
            })}
          </List.Section>
        );
      })}
    </List>
  );
}
