export const config = {
  runtime: "edge",
};

import type { APIRoute } from "astro";

import { verifyCleanupToken } from "../../lib/cleanup-token";
import { json } from "../../lib/http";
import { deleteSubmission } from "../../lib/webflow";

type RuntimeEnv = {
  WEBFLOW_API_TOKEN?: string;
  CLEANUP_SECRET?: string;
};

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as any).runtime?.env as
      | RuntimeEnv
      | undefined;

    const webflowToken = env?.WEBFLOW_API_TOKEN;
    const cleanupSecret = env?.CLEANUP_SECRET;

    if (!webflowToken || !cleanupSecret) {
      console.error("Required environment variables are missing.");
      return json(
        { error: "Server configuration error." },
        500,
      );
    }

    let body: { cleanup_token?: unknown };

    try {
      body = (await request.json()) as {
        cleanup_token?: unknown;
      };
    } catch {
      return json({ error: "Invalid JSON body." }, 400);
    }

    const cleanupToken = String(
      body.cleanup_token ?? "",
    ).trim();

    if (!cleanupToken) {
      return json(
        { error: "cleanup_token is required." },
        400,
      );
    }

    let payload;

    try {
      payload = await verifyCleanupToken(
        cleanupSecret,
        cleanupToken,
      );
    } catch {
      return json(
        { error: "Invalid or expired cleanup token." },
        401,
      );
    }

    const ids = [
      ...new Set([
        ...payload.leadSubmissionIds,
        ...payload.auditSubmissionIds,
      ]),
    ];

    let deleted = 0;

    /*
     * Delete sequentially. This stays well below Webflow Cloud's outbound
     * request concurrency limits and makes retries predictable.
     */
    for (const submissionId of ids) {
      await deleteSubmission(
        webflowToken,
        submissionId,
      );
      deleted += 1;
    }

    return json({
      ok: true,
      deleted,
    });
  } catch (error) {
    console.error("delete-old-submissions failed", error);

    /*
     * New submissions already exist by the time the browser calls this
     * endpoint, so the browser should log a cleanup warning rather than
     * tell the visitor that their lead was lost.
     */
    return json(
      { error: "Unable to clean up old submissions." },
      500,
    );
  }
};
