import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

function notFound() {
  return new Response("Not found", { status: 404 });
}

/** Quiet 404 for scanner paths like /js/raif_ch.js — no React Router stack dump. */
export async function loader(_args: LoaderFunctionArgs) {
  return notFound();
}

export async function action(_args: ActionFunctionArgs) {
  return notFound();
}
