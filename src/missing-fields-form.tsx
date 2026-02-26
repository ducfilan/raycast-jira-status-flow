import { ActionPanel, Action, Form, showToast, Toast, useNavigation } from "@raycast/api";
import { useState } from "react";
import { setIssueCustomFields } from "./utils";

interface MissingFieldsFormProps {
  issueKey: string;
  missingFields: string[];
  onComplete: () => void;
}

function isDateField(fieldName: string): boolean {
  return /date/i.test(fieldName);
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function MissingFieldsForm({ issueKey, missingFields, onComplete }: MissingFieldsFormProps) {
  const { pop } = useNavigation();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(values: Record<string, unknown>) {
    setSubmitting(true);
    const fields: Record<string, string> = {};

    for (const name of missingFields) {
      const id = name.replaceAll(/\s+/g, "_");
      const val = values[id];
      if (val instanceof Date) {
        fields[name] = formatDate(val);
      } else if (typeof val === "string" && val.trim()) {
        fields[name] = val.trim();
      }
    }

    if (Object.keys(fields).length === 0) {
      await showToast({ style: Toast.Style.Failure, title: "No values provided" });
      setSubmitting(false);
      return;
    }

    const toast = await showToast({ style: Toast.Style.Animated, title: "Setting fields…" });
    try {
      await setIssueCustomFields(issueKey, fields);
      toast.style = Toast.Style.Success;
      toast.title = "Fields updated";
      toast.message = Object.entries(fields)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
      pop();
      onComplete();
    } catch (e: unknown) {
      toast.style = Toast.Style.Failure;
      toast.title = "Failed to set fields";
      toast.message = e instanceof Error ? e.message : String(e);
      setSubmitting(false);
    }
  }

  return (
    <Form
      navigationTitle={`${issueKey} — Fill Required Fields`}
      isLoading={submitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save & Continue" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description text={`The following fields are required before transitioning ${issueKey}.`} />
      {missingFields.map((name) => {
        const id = name.replaceAll(/\s+/g, "_");
        if (isDateField(name)) {
          return <Form.DatePicker key={id} id={id} title={name} type={Form.DatePicker.Type.Date} />;
        }
        return <Form.TextField key={id} id={id} title={name} placeholder={`Enter ${name}`} />;
      })}
    </Form>
  );
}
