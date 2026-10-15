import { redirect } from "next/navigation";

/** The workspace home is My issues, as in Linear's default. */
export default async function WorkspaceHome({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  redirect(`/${workspace}/my-issues/assigned`);
}
