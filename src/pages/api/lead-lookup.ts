export const config = {
  runtime: "edge",
};

import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import {
  AUDIT_FORM_ELEMENT_ID,
  LEAD_FORM_ELEMENT_ID,
} from "../../lib/config";
import {
  isValidEmail,
  json,
  normalizeEmail,
} from "../../lib/http";
import { createCleanupToken } from "../../lib/cleanup-token";
import {
  listAllSubmissionsByElement,
  type WebflowSubmission,
} from "../../lib/webflow";

type RuntimeEnv = {
  WEBFLOW_API_TOKEN?: string;
  CLEANUP_SECRET?: string;
};

function newestFirst(
  submissions: WebflowSubmission[],
): WebflowSubmission[] {
  return [...submissions].sort((a, b) => {
    const aTime = Date.parse(a.dateSubmitted ?? "") || 0;
    const bTime = Date.parse(b.dateSubmitted ?? "") || 0;
    return bTime - aTime;
  });
}

function matchesEmail(
  submission: WebflowSubmission,
  email: string,
): boolean {
  return (
    normalizeEmail(submission.formResponse?.work_email) === email
  );
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const runtimeEnv = env as unknown as RuntimeEnv;

    const webflowToken = runtimeEnv.WEBFLOW_API_TOKEN;
    const cleanupSecret = runtimeEnv.CLEANUP_SECRET;

    if (!webflowToken || !cleanupSecret) {
      console.error("Required environment variables are missing.");
      return json(
        { error: "Server configuration error." },
        500,
      );
    }

    let body: { email?: unknown };

    try {
      body = (await request.json()) as { email?: unknown };
    } catch {
      return json({ error: "Invalid JSON body." }, 400);
    }

    const email = normalizeEmail(body.email);

    if (!isValidEmail(email)) {
      return json({ error: "Invalid email." }, 400);
    }

    const [leadSubmissions, auditSubmissions] =
      await Promise.all([
        listAllSubmissionsByElement(
          webflowToken,
          LEAD_FORM_ELEMENT_ID,
        ),
        listAllSubmissionsByElement(
          webflowToken,
          AUDIT_FORM_ELEMENT_ID,
        ),
      ]);

    const matchingLeads = newestFirst(
      leadSubmissions.filter((submission) =>
        matchesEmail(submission, email),
      ),
    );

    const matchingAudits = newestFirst(
      auditSubmissions.filter((submission) =>
        matchesEmail(submission, email),
      ),
    );

    /*
     * Preserve the stable custom lead_id from the newest existing Lead
     * record. If no usable lead_id exists, create a new one.
     */
    const existingLeadId = String(
      matchingLeads[0]?.formResponse?.lead_id ?? "",
    ).trim();

    const leadId =
      existingLeadId || crypto.randomUUID();

    /*
     * Include every old matching submission in the signed cleanup token.
     * This also cleans up historical duplicates safely after the two new
     * submissions have both succeeded.
     */
    const leadSubmissionIds = matchingLeads.map(
      (submission) => submission.id,
    );

    const auditSubmissionIds = matchingAudits.map(
      (submission) => submission.id,
    );

    const cleanupToken = await createCleanupToken(
      cleanupSecret,
      leadSubmissionIds,
      auditSubmissionIds,
    );

    return json({
      lead_id: leadId,
      cleanup_token: cleanupToken,
    });
  } catch (error) {
    console.error("lead-lookup failed", error);

    return json(
      { error: "Unable to look up the lead." },
      500,
    );
  }
};
