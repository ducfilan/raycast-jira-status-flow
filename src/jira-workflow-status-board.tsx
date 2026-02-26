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
import { useEffect, useState } from "react";
import {
  getMyInProgressIssues,
  transitionIssue,
  getNextStatus,
  getPreviousStatus,
  getWorkflowStep,
  getWorkflowIndex,
  getRemainingSteps,
  autoFillDevDates,
  parseMissingFieldsFromError,
  openIssueInJira,
  WORKFLOW,
  type JiraIssue,
} from "./utils";
import MissingFieldsForm from "./missing-fields-form";

const STATUS_COLORS: Record<string, Color> = {
  WAITING: Color.SecondaryText,
  DOING: Color.Orange,
  INTEGRATION: Color.Yellow,
  "1ST REVIEW": Color.Green,
  TESTING: Color.Blue,
  "2ND REVIEW": Color.Purple,
  UAT: Color.Blue,
  STAGING: Color.Red,
  REGRESSION: Color.Orange,
  DELIVERING: Color.Purple,
  DONE: Color.Green,
};

export default function WorkflowStatusBoard() {
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const { push } = useNavigation();

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const fetched = await getMyInProgressIssues();
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
  }

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
    const next = getNextStatus(issue.status);
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
      } catch (e: unknown) {
        toast.style = Toast.Style.Failure;
        toast.title = "Transition failed";
        await handleTransitionError(issue.key, e, doTransition);
      }
    };

    if (next.status === "Done") {
      await ensureDevDatesAndRun(issue.key, doTransition);
    } else {
      await doTransition();
    }
  }

  async function regressIssue(issue: JiraIssue) {
    const prev = getPreviousStatus(issue.status);
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
    } catch (e: unknown) {
      toast.style = Toast.Style.Failure;
      toast.title = "Transition failed";
      await handleTransitionError(issue.key, e, () => regressIssue(issue));
    }
  }

  async function moveToDone(issue: JiraIssue) {
    const remaining = getRemainingSteps(issue.status);
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

    // Pre-fill dev dates before attempting the full transition chain
    await ensureDevDatesAndRun(issue.key, doTransitions);
  }

  const workflowStatuses = WORKFLOW.filter((s) => s.status !== "Done").map((s) => s.status);

  const grouped = workflowStatuses.reduce<Record<string, JiraIssue[]>>((acc, status) => {
    acc[status] = issues.filter((i) => i.status.toUpperCase() === status.toUpperCase());
    return acc;
  }, {});

  const sectionedStatuses = workflowStatuses.filter(
    (s) => filter === "all" || s.toUpperCase() === filter.toUpperCase(),
  );

  return (
    <List
      isLoading={loading}
      searchBarPlaceholder="Search tickets…"
      searchBarAccessory={
        <List.Dropdown tooltip="Filter by status" onChange={setFilter}>
          <List.Dropdown.Item title="All In-Progress" value="all" />
          <List.Dropdown.Section title="Workflow Stages">
            {workflowStatuses.map((s) => {
              const step = getWorkflowStep(s)!;
              return <List.Dropdown.Item key={s} title={`${step.emoji} ${s}`} value={s} />;
            })}
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

        const step = getWorkflowStep(statusName)!;
        const idx = getWorkflowIndex(statusName);

        return (
          <List.Section
            key={statusName}
            title={`${step.emoji} ${statusName}`}
            subtitle={`${sectionIssues.length} ticket${sectionIssues.length !== 1 ? "s" : ""} · step ${idx + 1}/${WORKFLOW.length}`}
          >
            {sectionIssues.map((issue) => {
              const next = getNextStatus(issue.status);
              const remaining = getRemainingSteps(issue.status).length;
              const color = STATUS_COLORS[issue.status.toUpperCase()] ?? Color.PrimaryText;

              const prev = getPreviousStatus(issue.status);

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
                        <Action
                          title="Refresh Board"
                          onAction={load}
                          shortcut={{ modifiers: ["cmd"], key: "r" }}
                        />
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
