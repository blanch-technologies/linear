"use client";

import { notFound, useParams } from "next/navigation";
import { IssueView } from "@/components/issues/view/issue-view";
import { ViewTabs } from "@/components/issues/view/view-tabs";
import { useWorkspace } from "@/components/workspace/workspace-context";

const tabs = { assigned: "Assigned", created: "Created", subscribed: "Subscribed", activity: "Activity" } as const;
type Tab = keyof typeof tabs;

/** My issues (D-31): each tab derives from assignments, authorship, subscriptions, or history. */
export default function MyIssuesTab() {
  const { tab } = useParams<{ tab: string }>();
  const { href } = useWorkspace();
  if (!(tab in tabs)) notFound();
  const key = tab as Tab;
  return (
    <IssueView
      key={key}
      source={{ kind: "my", tab: key }}
      viewKey={`my:${key}`}
      emptyTitle={`Nothing ${key === "activity" ? "here" : key} yet`}
      emptyBody={key === "assigned" ? "Issues assigned to you show up here." : "Issues show up here as you work."}
      header={<ViewTabs current={key} tabs={(Object.keys(tabs) as Tab[]).map((t) => ({ key: t, label: tabs[t], href: href("my-issues", t) }))} />}
    />
  );
}
