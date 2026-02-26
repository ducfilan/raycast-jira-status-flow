import {
  ActionPanel,
  Action,
  Detail,
  Form,
  showToast,
  Toast,
  Clipboard,
  openExtensionPreferences,
  confirmAlert,
  Alert,
  LaunchProps,
  useNavigation,
} from "@raycast/api";
import { useEffect, useState, useRef } from "react";
import {
  resolveTicketKey,
  getIssueDetails,
  transitionIssue,
  getRemainingSteps,
  getWorkflowStep,
  getWorkflowIndex,
  autoFillDevDates,
  parseMissingFieldsFromError,
  WORKFLOW,
  type JiraIssue,
} from "./utils";
import MissingFieldsForm from "./missing-fields-form";

type TransitionState =
  | { phase: "idle" }
  | { phase: "running"; currentTransition: string; completedSteps: string[]; totalSteps: number }
  | { phase: "done" }
  | { phase: "error"; failedAt: string; completedSteps: string[]; error: string };

export default function MoveToDone(props: LaunchProps<{ arguments: Arguments.JiraMoveToDone }>) {
  const [issue, setIssue] = useState<JiraIssue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [transition, setTransition] = useState<TransitionState>({ phase: "idle" });
  const [needsTicketInput, setNeedsTicketInput] = useState(false);
  const abortRef = useRef(false);
  const { push } = useNavigation();

  useEffect(() => {
    load();
    return () => {
      abortRef.current = true;
    };
  }, []);

  async function load(overrideKey?: string) {
    setLoading(true);
    setError(null);
    setNeedsTicketInput(false);
    abortRef.current = false;
    try {
      const argKey = overrideKey || props.arguments.ticketKey;
      if (!argKey?.trim()) {
        const clipText = (await Clipboard.readText())?.trim() || "";
        if (!/^[A-Z]+-\d+$/i.test(clipText)) {
          setNeedsTicketInput(true);
          return;
        }
      }
      const key = await resolveTicketKey(argKey);
      const details = await getIssueDetails(key);
      setIssue(details);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function runTransitionLoop(issueData: JiraIssue) {
    const remaining = getRemainingSteps(issueData.status);
    if (remaining.length === 0) {
      setIssue((prev) => (prev ? { ...prev, status: "Done" } : prev));
      setTransition({ phase: "done" });
      return;
    }

    abortRef.current = false;
    const completedSteps: string[] = [];

    setTransition({
      phase: "running",
      currentTransition: `${issueData.status} → ${remaining[0].status}`,
      completedSteps,
      totalSteps: remaining.length,
    });

    let currentStatus = issueData.status;

    for (const step of remaining) {
      if (abortRef.current) break;

      setTransition({
        phase: "running",
        currentTransition: `${currentStatus} → ${step.status}`,
        completedSteps: [...completedSteps],
        totalSteps: remaining.length,
      });

      const toast = await showToast({
        style: Toast.Style.Animated,
        title: `Transitioning ${issueData.key}`,
        message: `${currentStatus} → ${step.status}`,
      });

      try {
        await transitionIssue(issueData.key, step.status);
        completedSteps.push(`${step.emoji} ${step.status}`);
        currentStatus = step.status;
        toast.style = Toast.Style.Success;
        toast.title = `Done: ${step.status}`;
        toast.message = completedSteps.length < remaining.length ? "Continuing…" : "All done!";

        if (completedSteps.length < remaining.length) {
          await sleep(600);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.style = Toast.Style.Failure;
        toast.title = "Transition failed";

        setIssue((prev) => (prev ? { ...prev, status: currentStatus } : prev));

        const missingFields = parseMissingFieldsFromError(msg);
        if (missingFields.length > 0) {
          toast.hide();
          const resumeIssue = { ...issueData, status: currentStatus };
          push(
            <MissingFieldsForm
              issueKey={issueData.key}
              missingFields={missingFields}
              onComplete={() => runTransitionLoop(resumeIssue)}
            />,
          );
        } else {
          toast.message = msg;
          setTransition({ phase: "error", failedAt: step.status, completedSteps, error: msg });
        }
        return;
      }
    }

    setIssue((prev) => (prev ? { ...prev, status: "Done" } : prev));
    setTransition({ phase: "done" });
  }

  async function startMoveToDone() {
    if (!issue) return;

    const remaining = getRemainingSteps(issue.status);

    if (remaining.length === 0) {
      await showToast({ style: Toast.Style.Success, title: `${issue.key} is already Done!` });
      return;
    }

    if (remaining.length > 1) {
      const confirmed = await confirmAlert({
        title: `Move ${issue.key} through ${remaining.length} stages?`,
        message: `This will transition:\n${issue.status} → ${remaining.map((s) => s.status).join(" → ")}`,
        primaryAction: { title: "Move to Done", style: Alert.ActionStyle.Default },
        dismissAction: { title: "Cancel" },
      });
      if (!confirmed) return;
    }

    // Pre-fill Dev dates from Planned counterparts before starting transitions
    const toast = await showToast({ style: Toast.Style.Animated, title: "Checking required fields…" });
    try {
      const { filled, stillMissing } = await autoFillDevDates(issue.key);
      if (filled.length > 0) {
        toast.title = "Auto-filled dates";
        toast.message = filled.join(", ");
      }
      toast.hide();

      if (stillMissing.length > 0) {
        push(
          <MissingFieldsForm
            issueKey={issue.key}
            missingFields={stillMissing}
            onComplete={() => runTransitionLoop(issue)}
          />,
        );
        return;
      }
    } catch (e: unknown) {
      toast.style = Toast.Style.Failure;
      toast.title = "Auto-fill failed, continuing…";
      toast.message = e instanceof Error ? e.message : String(e);
    }

    await runTransitionLoop(issue);
  }

  if (needsTicketInput) {
    return (
      <Form
        actions={
          <ActionPanel>
            <Action.SubmitForm
              title="Look Up Ticket"
              onSubmit={(values: { ticketKey: string }) => load(values.ticketKey)}
            />
          </ActionPanel>
        }
      >
        <Form.Description text="No ticket key was provided and clipboard doesn't contain a valid ticket key." />
        <Form.TextField id="ticketKey" title="Ticket Key" placeholder="PROJ-123" />
      </Form>
    );
  }

  if (loading) {
    return <Detail isLoading markdown="# Fetching ticket…" />;
  }

  if (error) {
    return (
      <Detail
        markdown={`# Error\n\n\`\`\`\n${error}\n\`\`\`\n\n**Troubleshooting:**\n- Make sure \`jira\` CLI is installed and authenticated\n- Try running \`jira issue view PROJ-123\` in your terminal`}
        actions={
          <ActionPanel>
            <Action title="Open Preferences" onAction={openExtensionPreferences} />
            <Action title="Retry" onAction={load} />
          </ActionPanel>
        }
      />
    );
  }

  if (!issue) return null;

  const currentStep = getWorkflowStep(issue.status);
  const currentIndex = getWorkflowIndex(issue.status);
  const remaining = getRemainingSteps(issue.status);
  const isRunning = transition.phase === "running";
  const isDone = transition.phase === "done" || issue.status === "Done";

  const markdown = buildMarkdown(issue, transition, remaining, currentIndex);

  return (
    <Detail
      isLoading={isRunning}
      markdown={markdown}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Ticket" text={issue.key} />
          <Detail.Metadata.Label title="Summary" text={issue.summary || "—"} />
          <Detail.Metadata.Label title="Status" text={`${currentStep?.emoji ?? ""} ${issue.status}`} />
          <Detail.Metadata.Label title="Assignee" text={issue.assignee || "Unassigned"} />
          <Detail.Metadata.Separator />
          {remaining.length > 0 && (
            <Detail.Metadata.Label title="Steps Remaining" text={`${remaining.length} (ends at 🎉 Done)`} />
          )}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          {!isDone && !isRunning && (
            <Action
              title={remaining.length === 1 ? "Move to Done" : `Move Through ${remaining.length} Stages to Done`}
              shortcut={{ modifiers: ["cmd"], key: "return" }}
              onAction={startMoveToDone}
            />
          )}
          {!isDone && !isRunning && remaining.length > 1 && (
            <Action
              title="Advance One Step Only"
              shortcut={{ modifiers: ["cmd", "shift"], key: "return" }}
              onAction={async () => {
                const next = remaining[0];
                const doAdvance = async () => {
                  const toast = await showToast({ style: Toast.Style.Animated, title: `Advancing to ${next.status}` });
                  try {
                    await transitionIssue(issue.key, next.status);
                    setIssue({ ...issue, status: next.status });
                    toast.style = Toast.Style.Success;
                    toast.title = `Moved to ${next.status}`;
                  } catch (e: unknown) {
                    const msg = e instanceof Error ? e.message : String(e);
                    toast.style = Toast.Style.Failure;
                    const missingFields = parseMissingFieldsFromError(msg);
                    if (missingFields.length > 0) {
                      toast.hide();
                      push(
                        <MissingFieldsForm issueKey={issue.key} missingFields={missingFields} onComplete={doAdvance} />,
                      );
                    } else {
                      toast.message = msg;
                    }
                  }
                };
                await doAdvance();
              }}
            />
          )}
          <Action
            title="Copy Ticket Key"
            shortcut={{ modifiers: ["cmd"], key: "c" }}
            onAction={() => Clipboard.copy(issue.key)}
          />
          <Action title="Reload" shortcut={{ modifiers: ["cmd"], key: "r" }} onAction={load} />
          <Action title="Open Preferences" onAction={openExtensionPreferences} />
        </ActionPanel>
      }
    />
  );
}

function buildMarkdown(
  issue: JiraIssue,
  transition: TransitionState,
  remaining: ReturnType<typeof getRemainingSteps>,
  currentIndex: number,
): string {
  if (transition.phase === "done" || issue.status === "Done") {
    return `# ${issue.key} — Done!

All workflow stages completed successfully.

> ${issue.summary || ""}

---

\`\`\`
📋 → 🔨 → 🔗 → 👀 → 🧪 → 🔍 → ✅ → 🚀 → 🔄 → 🎉
\`\`\`
`;
  }

  if (transition.phase === "running") {
    const { completedSteps, currentTransition, totalSteps } = transition;
    const bar = "▓".repeat(completedSteps.length) + "░".repeat(totalSteps - completedSteps.length);
    return `# ${issue.key} — Transitioning…

\`[${bar}]\` ${completedSteps.length} / ${totalSteps}

**Now:** ${currentTransition}

${completedSteps.map((s) => `- ${s}`).join("\n")}
`;
  }

  if (transition.phase === "error") {
    const { completedSteps, failedAt, error } = transition;
    return `# ${issue.key} — Transition Failed

**Failed at:** ${failedAt}

${completedSteps.length > 0 ? `**Completed before failure:**\n${completedSteps.map((s) => `- ${s}`).join("\n")}` : ""}

**Error:**
\`\`\`
${error}
\`\`\`

Ticket is currently at: **${issue.status}**

Press **⌘ + Return** to retry from here.
`;
  }

  const pathSteps = remaining.map((s) => `${s.emoji} ${s.status}`).join(" → ");
  const totalSteps = WORKFLOW.length - 1;
  const progress = currentIndex >= 0 ? Math.round((currentIndex / totalSteps) * 100) : 0;

  return `# ${issue.key} — Move to Done

## Current Status: ${getWorkflowStep(issue.status)?.emoji ?? ""} ${issue.status}

**Progress:** ${progress}% complete (${remaining.length} step${remaining.length !== 1 ? "s" : ""} remaining)

---

### Path to Done:

> **${issue.status}** → ${pathSteps}

Press **⌘ + Return** to execute all ${remaining.length} transition${remaining.length !== 1 ? "s" : ""} automatically.
`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
