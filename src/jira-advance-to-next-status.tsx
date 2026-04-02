import {
  ActionPanel,
  Action,
  Detail,
  Form,
  List,
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
  getWorkflowStep,
  getWorkflowIndex,
  getWorkflowForType,
  getTransitionPathToTarget,
  normalizeStatus,
  autoFillDevDates,
  parseMissingFieldsFromError,
  isDocType,
  type JiraIssue,
  type WorkflowStep,
} from "./utils";
import MissingFieldsForm from "./missing-fields-form";

type TransitionState =
  | { phase: "idle" }
  | { phase: "running"; currentTransition: string; completedSteps: string[]; totalSteps: number }
  | { phase: "done" }
  | { phase: "error"; failedAt: string; completedSteps: string[]; error: string };

export default function AdvanceStatus(props: Readonly<LaunchProps<{ arguments: Arguments.JiraAdvanceToNextStatus }>>) {
  const [issue, setIssue] = useState<JiraIssue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [transition, setTransition] = useState<TransitionState>({ phase: "idle" });
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

  async function runChainedTransitions(startIssue: JiraIssue, path: WorkflowStep[]) {
    if (path.length === 0) return;

    const completedSteps: string[] = [];
    let current = startIssue;

    setTransition({ phase: "running", currentTransition: path[0].status, completedSteps, totalSteps: path.length });

    for (let i = 0; i < path.length; i++) {
      const next = path[i];

      const toast = await showToast({
        style: Toast.Style.Animated,
        title: `Moving ${startIssue.key}`,
        message: `${i + 1}/${path.length}: ${current.status} → ${next.status}`,
      });

      setTransition({ phase: "running", currentTransition: next.status, completedSteps, totalSteps: path.length });

      try {
        await transitionIssue(current.key, next.status);
        completedSteps.push(`${next.emoji} ${next.status}`);
        
        toast.style = Toast.Style.Success;
        toast.title = `Moved to ${next.status}`;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        const missingFields = parseMissingFieldsFromError(msg);
        
        if (missingFields.length > 0) {
          toast.hide();
          push(
            <MissingFieldsForm
              issueKey={current.key}
              missingFields={missingFields}
              onComplete={() => {
                void runChainedTransitions(current, path.slice(i));
              }}
            />,
          );
          return;
        }
        
        toast.style = Toast.Style.Failure;
        toast.title = "Transition failed";
        toast.message = msg;
        
        setTransition({ phase: "error", failedAt: next.status, completedSteps, error: msg });
        return;
      }

      current = { ...current, status: next.status };
      setIssue(current);
    }

    setTransition({ phase: "done" });

    const last = path.at(-1)!;
    await showToast({
      style: Toast.Style.Success,
      title: `${startIssue.key} → ${last.status}`,
      message: path.length > 1 ? `${path.length} steps — now ${last.emoji} ${last.status}` : `Now: ${last.emoji} ${last.status}`
    });
  }

  async function handleTransition(targetStep: WorkflowStep) {
    if (!issue) return;

    const path = getTransitionPathToTarget(issue.status, targetStep.status, issue.type);
    if (!path) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Unknown status",
        message: `"${issue.status}" or "${targetStep.status}" is not in this issue's workflow.`,
      });
      return;
    }
    if (path.length === 0) {
      await showToast({ style: Toast.Style.Failure, title: "Already at that status" });
      return;
    }

    const finalIsDone = path.at(-1)?.status === "Done";
    if (finalIsDone && !isDocType(issue.type)) {
      const preToast = await showToast({ style: Toast.Style.Animated, title: "Checking required fields…" });
      try {
        const { filled, stillMissing } = await autoFillDevDates(issue.key);
        if (filled.length > 0) {
          preToast.title = "Auto-filled dates";
          preToast.message = filled.join(", ");
        }
        preToast.hide();

        if (stillMissing.length > 0) {
          push(
            <MissingFieldsForm
              issueKey={issue.key}
              missingFields={stillMissing}
              onComplete={() => {
                void runChainedTransitions(issue, path);
              }}
            />,
          );
          return;
        }
      } catch (e: unknown) {
        preToast.style = Toast.Style.Failure;
        preToast.title = "Auto-fill failed, continuing…";
        preToast.message = e instanceof Error ? e.message : String(e);
      }
    }

    await runChainedTransitions(issue, path);
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

  if (loading && !issue) {
    return (
      <List isLoading>
        <List.EmptyView
          title="Fetching ticket..."
          description={`Resolving ${props.arguments.ticketKey || "from clipboard"}…`}
        />
      </List>
    );
  }

  if (error) {
    return (
      <Detail
        markdown={`# Error\n\n\`\`\`\n${error}\n\`\`\`\n\n**Troubleshooting:**\n- Make sure \`jira\` CLI is installed and authenticated\n- Check the Jira CLI path in extension preferences\n- Try running \`jira issue view PROJ-123\` in your terminal`}
        actions={
          <ActionPanel>
            <Action title="Open Preferences" onAction={openExtensionPreferences} />
            <Action title="Retry" onAction={() => load()} />
          </ActionPanel>
        }
      />
    );
  }

  if (!issue) return null;

  const workflow = getWorkflowForType(issue.type);
  const currentStep = getWorkflowStep(issue.status, issue.type);
  const nextStep = getNextStatus(issue.status, issue.type);
  const currentIndex = getWorkflowIndex(issue.status, issue.type);
  const progress = currentIndex >= 0 ? Math.round((currentIndex / (workflow.length - 1)) * 100) : 0;
  const progressBar = buildProgressBar(currentIndex, workflow.length);

  const isRunning = transition.phase === "running";
  const isDoneUi = transition.phase === "done" || normalizeStatus(issue.status) === normalizeStatus("Done");
  const markdown = isDoneUi
    ? buildDoneMarkdown(issue, workflow)
    : buildAdvanceMarkdown(issue, workflow, currentStep, nextStep, progressBar, progress, transition);

  const metadata = (
    <List.Item.Detail.Metadata>
      <List.Item.Detail.Metadata.Label title="Ticket" text={issue.key} />
      <List.Item.Detail.Metadata.Label title="Summary" text={issue.summary || "—"} />
      <List.Item.Detail.Metadata.Label title="Status" text={`${currentStep?.emoji ?? ""} ${issue.status}`} />
      <List.Item.Detail.Metadata.Label title="Assignee" text={issue.assignee || "Unassigned"} />
      <List.Item.Detail.Metadata.Label title="Priority" text={issue.priority || "—"} />
      <List.Item.Detail.Metadata.Label title="Type" text={issue.type || "—"} />
      <List.Item.Detail.Metadata.Separator />
      <List.Item.Detail.Metadata.Label
        title="Progress"
        text={`${progress}% (step ${Math.max(currentIndex, 0) + 1} of ${workflow.length})`}
      />
      {nextStep && (
        <List.Item.Detail.Metadata.Label title="Next Status" text={`${nextStep.emoji} ${nextStep.status}`} />
      )}
    </List.Item.Detail.Metadata>
  );

  return (
    <List isShowingDetail>
      {nextStep && (
        <List.Item
          title={`Next: ${nextStep.status}`}
          icon={nextStep.emoji}
          subtitle={nextStep.description}
          detail={<List.Item.Detail isLoading={isRunning} markdown={markdown} metadata={metadata} />}
          actions={
            <ActionPanel>
              {!isRunning && <Action title={`Advance to ${nextStep.status}`} onAction={() => handleTransition(nextStep)} />}
              <Action
                title="Copy Ticket Key"
                shortcut={{ modifiers: ["cmd"], key: "c" }}
                onAction={() => Clipboard.copy(issue.key)}
              />
              <Action title="Reload" shortcut={{ modifiers: ["cmd"], key: "r" }} onAction={() => load()} />
              <Action title="Open Preferences" onAction={openExtensionPreferences} />
            </ActionPanel>
          }
        />
      )}
      {workflow.map((step) => {
        if (step.status === nextStep?.status) return null;
        if (normalizeStatus(step.status) === normalizeStatus(issue.status)) return null;

        const hopCount = getTransitionPathToTarget(issue.status, step.status, issue.type)?.length ?? 0;
        const subtitle = hopCount > 1 ? `${step.description} · ${hopCount} steps` : step.description;

        return (
          <List.Item
            key={step.status}
            title={step.status}
            icon={step.emoji}
            subtitle={subtitle}
            detail={<List.Item.Detail isLoading={isRunning} markdown={markdown} metadata={metadata} />}
            actions={
              <ActionPanel>
                {!isRunning && <Action title={`Move to ${step.status}`} onAction={() => handleTransition(step)} />}
                <Action
                  title="Copy Ticket Key"
                  shortcut={{ modifiers: ["cmd"], key: "c" }}
                  onAction={() => Clipboard.copy(issue.key)}
                />
                <Action title="Reload" shortcut={{ modifiers: ["cmd"], key: "r" }} onAction={() => load()} />
                <Action title="Open Preferences" onAction={openExtensionPreferences} />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
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
  progressBar: string,
  progress: number,
  transition: TransitionState,
): string {
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

Check the toast or run this command again after fixing the issue in Jira.
`;
  }

  const normStatus = normalizeStatus(issue.status);
  const workflowTable = workflow
    .map((step, idx) => {
      const isCurrent = normalizeStatus(step.status) === normStatus;
      const isPast = idx < workflow.findIndex((s) => normalizeStatus(s.status) === normStatus);
      const marker = isCurrent ? "◀ **current**" : isPast ? "~~done~~" : "";
      return `| ${step.emoji} | ${isCurrent ? `**${step.status}**` : isPast ? `~~${step.status}~~` : step.status} | ${step.description} | ${marker} |`;
    })
    .join("\n");

  const hints = [
    nextStep
      ? `> Pick a status to walk the workflow step-by-step until you reach it (avoids invalid transitions).\n> **Next: ${nextStep.status}** — ${nextStep.description}`
      : `> This ticket is already at the final stage!`,
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
