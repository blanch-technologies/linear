import { redirect } from "next/navigation";

/** My issues opens on the Assigned tab. Redirects on the server so there's no second client hop. */
export default async function MyIssuesIndex({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  redirect(`/${workspace}/my-issues/assigned`);
}
