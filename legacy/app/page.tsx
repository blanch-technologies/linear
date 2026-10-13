import Script from "next/script";
import { requireChatGPTUser } from "./chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireChatGPTUser("/");
  return (
    <>
      <div id="app" />
      <div id="overlay-root" />
      <div id="toast-root" aria-live="polite" />
      <Script src="/linear.js" strategy="afterInteractive" />
      <Script src="/linear-workflows.js" strategy="afterInteractive" />
    </>
  );
}
