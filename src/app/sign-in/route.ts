import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";

// WorkOS "Initiate login URI"; also used by impersonation.
export async function GET() {
  redirect(await getSignInUrl());
}
