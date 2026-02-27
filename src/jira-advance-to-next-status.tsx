import {
  ActionPanel,
  Action,
  Detail,
  Form,
  showToast,
  Toast,
  Clipboard,
  openExtensionPreferences,
  LaunchProps,
  useNavigation,
} from "@raycast/api";
import { useEffect, useState } from "react";
import {
  resolveTicketKey,
  getIssueDetails,
  transitionIssue,
  getNextStatus,
  getPreviousStatus,
  getWorkflowStep,
  getWorkflowIndex,
  getWorkflowForType,
  normalizeStatus,
  autoFillDevDates,
  parseMissingFieldsFromError,
  isDocType,
  type JiraIssue,
  type WorkflowStep,
} from "./utils";
import MissingFieldsForm from "./missing-fields-form";

export default function AdvanceStatus(props: Readonly<LaunchProps<{ arguments: Arguments.JiraAdvanceToNextStatus }>>) {
  const [issue, setIssue] = useState<JiraIssue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [transitioning, setTransitioning] = useState(false);
  const [done, setDone] = useState(false);
  const [needsTicketInput, setNeedsTicketInput] = useState(false);
  const { push } = useNavigation();

  useEffect(() => {
    load();
  }, []);

  async function load(overrideKey?: string) {
    setLoading(true);
    setError(null);
    setNeedsTicketInput(false);
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

  async function doTransition(issueData: JiraIssue, next: WorkflowStep) {
    setTransitioning(true);
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: `Moving ${issueData.key}`,
      message: `${issueData.status} → ${next.status}`,
    });

    try {
      await transitionIssue(issueData.key, next.status);
      const updatedIssue = { ...issueData, status: next.status };
      setIssue(updatedIssue);
      setDone(next.status === "Done");
      toast.style = Toast.Style.Success;
      toast.title = `${issueData.key} advanced!`;
      toast.message = `Now: ${next.emoji} ${next.status}`;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.style = Toast.Style.Failure;
      toast.title = "Transition failed";

      const missingFields = parseMissingFieldsFromError(msg);
      if (missingFields.length > 0) {
        toast.hide();
        push(
          <MissingFieldsForm
            issueKey={issueData.key}
            missingFields={missingFields}
            onComplete={() => doTransition(issueData, next)}
          />,
        );
      } else {
        toast.message = msg;
      }
    } finally {
      setTransitioning(false);
    }
  }

  async function advance() {
    if (!issue) return;
    const next = getNextStatus(issue.status, issue.type);
    if (!next) {
      await showToast({ style: Toast.Style.Failure, title: "Already at final status" });
      return;
    }

    if (next.status === "Done" && !isDocType(issue.type)) {
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
              onComplete={() => doTransition(issue, next)}
            />,
          );
          return;
        }
      } catch (e: unknown) {
        toast.style = Toast.Style.Failure;
        toast.title = "Auto-fill failed, continuing…";
        toast.message = e instanceof Error ? e.message : String(e);
      }
    }

    await doTransition(issue, next);
  }

  async function regress() {
    if (!issue) return;
    const prev = getPreviousStatus(issue.status, issue.type);
    if (!prev) {
      await showToast({ style: Toast.Style.Failure, title: "Already at first status" });
      return;
    }

    setTransitioning(true);
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: `Moving ${issue.key} back`,
      message: `${issue.status} → ${prev.status}`,
    });

    try {
      await transitionIssue(issue.key, prev.status);
      const updatedIssue = { ...issue, status: prev.status };
      setIssue(updatedIssue);
      setDone(false);
      toast.style = Toast.Style.Success;
      toast.title = `${issue.key} moved back`;
      toast.message = `${prev.emoji} ${prev.status}`;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.style = Toast.Style.Failure;
      toast.title = "Transition failed";
      toast.message = msg;
    } finally {
      setTransitioning(false);
    }
  }

  if (needsTicketInput) {
    return (
      <Form
        actions={
          <ActionPanel>
            <Action.SubmitForm
              title="Look up Ticket"
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
    return (
      <Detail
        isLoading
        markdown={`# Fetching ticket...\n\nResolving ${props.arguments.ticketKey || "from clipboard"}…`}
      />
    );
  }

  if (error) {
    return (
      <Detail
        markdown={`# Error\n\n\`\`\`\n${error}\n\`\`\`\n\n**Troubleshooting:**\n- Make sure \`jira\` CLI is installed and authenticated\n- Check the Jira CLI path in extension preferences\n- Try running \`jira issue view PROJ-123\` in your terminal`}
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

  const workflow = getWorkflowForType(issue.type);
  const currentStep = getWorkflowStep(issue.status, issue.type);
  const nextStep = getNextStatus(issue.status, issue.type);
  const prevStep = getPreviousStatus(issue.status, issue.type);
  const currentIndex = getWorkflowIndex(issue.status, issue.type);
  const progress = currentIndex >= 0 ? Math.round((currentIndex / (workflow.length - 1)) * 100) : 0;
  const progressBar = buildProgressBar(currentIndex, workflow.length);

  const markdown = done
    ? buildDoneMarkdown(issue, workflow)
    : buildAdvanceMarkdown(issue, workflow, currentStep, nextStep, prevStep, progressBar, progress);

  return (
    <Detail
      isLoading={transitioning}
      markdown={markdown}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Ticket" text={issue.key} />
          <Detail.Metadata.Label title="Summary" text={issue.summary || "—"} />
          <Detail.Metadata.Label title="Status" text={`${currentStep?.emoji ?? ""} ${issue.status}`} />
          <Detail.Metadata.Label title="Assignee" text={issue.assignee || "Unassigned"} />
          <Detail.Metadata.Label title="Priority" text={issue.priority || "—"} />
          <Detail.Metadata.Label title="Type" text={issue.type || "—"} />
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label
            title="Progress"
            text={`${progress}% (step ${Math.max(currentIndex, 0) + 1} of ${workflow.length})`}
          />
          {nextStep && (
            <Detail.Metadata.Label title="Next Status" text={`${nextStep.emoji} ${nextStep.status}`} />
          )}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          {!done && nextStep && (
            <Action
              title={`Advance to ${nextStep.status}`}
              shortcut={{ modifiers: ["cmd"], key: "return" }}
              onAction={advance}
            />
          )}
          {prevStep && (
            <Action
              title={`Move Back to ${prevStep.status}`}
              shortcut={{ modifiers: ["cmd"], key: "backspace" }}
              onAction={regress}
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

function buildProgressBar(currentIndex: number, total: number): string {
  const filled = Math.max(0, currentIndex);
  const empty = total - filled - 1;
  return "🟩".repeat(filled) + "🔵" + "⬜".repeat(empty);
}

function buildAdvanceMarkdown(
  issue: JiraIssue,
  workflow: WorkflowStep[],
  currentStep: WorkflowStep | undefined,
  nextStep: WorkflowStep | null,
  prevStep: WorkflowStep | null,
  progressBar: string,
  progress: number,
): string {
  const normStatus = normalizeStatus(issue.status);
  const workflowTable = workflow.map((step, idx) => {
    const isCurrent = normalizeStatus(step.status) === normStatus;
    const isPast = idx < workflow.findIndex((s) => normalizeStatus(s.status) === normStatus);
    const marker = isCurrent ? "◀ **current**" : isPast ? "~~done~~" : "";
    return `| ${step.emoji} | ${isCurrent ? `**${step.status}**` : isPast ? `~~${step.status}~~` : step.status} | ${step.description} | ${marker} |`;
  }).join("\n");

  const hints = [
    nextStep
      ? `> Press **⌘ + Return** to advance to **${nextStep.emoji} ${nextStep.status}**\n> ${nextStep.description}`
      : `> This ticket is already at the final stage!`,
    prevStep
      ? `> Press **⌘ + ⌫** to move back to **${prevStep.emoji} ${prevStep.status}**`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return `# ${issue.key} — Advance Status (${issue.type || "Task"})

## ${currentStep?.emoji ?? "🔘"} Current: ${issue.status}

${progressBar}
**Progress: ${progress}%**

${hints}

---

## Workflow

| | Status | Description | |
|---|---|---|---|
${workflowTable}
`;
}

function buildDoneMarkdown(issue: JiraIssue, workflow: WorkflowStep[]): string {
  const chain = workflow.map((s) => `${s.emoji} ${s.status}`).join(" → ");
  return `# ${issue.key} is Done!

## All stages complete

The ticket has been moved through the entire workflow and is now marked as **Done**.

> "${issue.summary}"

---

\`\`\`
${chain}
\`\`\`
`;
}
