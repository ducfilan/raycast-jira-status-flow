import { ActionPanel, Action, Form, showToast, Toast, useNavigation } from "@raycast/api";
import { useState, useEffect } from "react";
import { setIssueCustomFields, getRoleAssignee, getCurrentUser } from "./utils";

interface MissingFieldsFormProps {
  issueKey: string;
  missingFields: string[];
  onComplete: () => void;
}

function isDateField(fieldName: string): boolean {
  return /date/i.test(fieldName);
}

function isUserField(fieldName: string): boolean {
  const lower = fieldName.toLowerCase();
  return lower.includes("developer") || lower.includes("reviewer") || lower.includes("qa") || lower.includes("assignee");
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
  const [defaultValues, setDefaultValues] = useState<Record<string, string | Date>>({});
  const [loadingDefaults, setLoadingDefaults] = useState(true);

  useEffect(() => {
    async function loadDefaults() {
      const defaults: Record<string, string | Date> = {};
      try {
        const currentUser = await getCurrentUser();
        
        for (const name of missingFields) {
          const lower = name.toLowerCase();
          const id = name.replaceAll(/\s+/g, "_");
          
          if (isDateField(name)) {
            defaults[id] = new Date();
          } else if (lower.includes("developer")) {
            defaults[id] = getRoleAssignee("developer") || currentUser.emailAddress || currentUser.displayName;
          } else if (lower.includes("qa") || lower.includes("tester")) {
            defaults[id] = getRoleAssignee("qa") || currentUser.emailAddress || currentUser.displayName;
          } else if (lower.includes("reviewer")) {
            defaults[id] = getRoleAssignee("reviewer") || currentUser.emailAddress || currentUser.displayName;
          } else if (isUserField(name)) {
            defaults[id] = currentUser.emailAddress || currentUser.displayName;
          }
        }
      } catch (e) {
        // silently fail and just don't set defaults
      }
      
      setDefaultValues(defaults);
      setLoadingDefaults(false);
    }
    
    loadDefaults();
  }, [missingFields]);

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
      isLoading={submitting || loadingDefaults}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save & Continue" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description text={`The following fields are required before transitioning ${issueKey}.`} />
      {!loadingDefaults && missingFields.map((name) => {
        const id = name.replaceAll(/\s+/g, "_");
        const defaultVal = defaultValues[id];
        
        if (isDateField(name)) {
          return <Form.DatePicker key={id} id={id} title={name} type={Form.DatePicker.Type.Date} defaultValue={defaultVal as Date | undefined} />;
        }
        return <Form.TextField key={id} id={id} title={name} placeholder={`Enter ${name}`} defaultValue={defaultVal as string | undefined} />;
      })}
    </Form>
  );
}
