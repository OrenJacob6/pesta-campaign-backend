export const config = {
  runtime: "edge",
};

import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

import {
  AUDIT_FORM_ELEMENT_ID,
  LEAD_FORM_ELEMENT_ID,
  MAIN_LEAD_FORM_ELEMENT_ID,
  MAIN_WEBFLOW_SITE_ID,
  WEBFLOW_SITE_ID,
} from "../../lib/config";

import {
  isValidEmail,
  json,
  normalizeEmail,
} from "../../lib/http";

import {
  createCleanupToken,
} from "../../lib/cleanup-token";

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
    const aTime =
      Date.parse(a.dateSubmitted ?? "") || 0;

    const bTime =
      Date.parse(b.dateSubmitted ?? "") || 0;

    return bTime - aTime;
  });
}

function matchesEmail(
  submission: WebflowSubmission,
  email: string,
): boolean {
  return (
    normalizeEmail(
      submission.formResponse?.work_email,
    ) === email
  );
}

function findExistingLeadId(
  submissions: WebflowSubmission[],
): string {
  for (const submission of submissions) {
    const leadId = String(
      submission.formResponse?.lead_id ?? "",
    ).trim();

    if (leadId) {
      return leadId;
    }
  }

  return "";
}

export const POST: APIRoute =
  async ({ request }) => {
    try {
      const runtimeEnv =
        env as unknown as RuntimeEnv;

      const webflowToken =
        runtimeEnv.WEBFLOW_API_TOKEN;

      const cleanupSecret =
        runtimeEnv.CLEANUP_SECRET;

      if (
        !webflowToken ||
        !cleanupSecret
      ) {
        console.error(
          "Required environment variables are missing.",
        );

        return json(
          {
            error:
              "Server configuration error.",
          },
          500,
        );
      }

      let body: {
        email?: unknown;
        source?: unknown;
      };

      try {
        body =
          (await request.json()) as {
            email?: unknown;
            source?: unknown;
          };
      } catch {
        return json(
          {
            error:
              "Invalid JSON body.",
          },
          400,
        );
      }

      const email =
        normalizeEmail(body.email);

      if (!isValidEmail(email)) {
        return json(
          {
            error:
              "Invalid email.",
          },
          400,
        );
      }

      /*
       * Existing Audit code does not send a source,
       * so default to promo.
       */
      const source =
        body.source === undefined
          ? "promo"
          : body.source;

      if (
        source !== "promo" &&
        source !== "main"
      ) {
        return json(
          {
            error:
              "Invalid lead source.",
          },
          400,
        );
      }

      /*
       * Search both Lead Details sources,
       * plus the Audit form on promo.
       */
      const [
        campaignLeadSubmissions,
        mainLeadSubmissions,
        auditSubmissions,
      ] = await Promise.all([
        listAllSubmissionsByElement(
          webflowToken,
          LEAD_FORM_ELEMENT_ID,
        ),

        listAllSubmissionsByElement(
          webflowToken,
          MAIN_LEAD_FORM_ELEMENT_ID,
          MAIN_WEBFLOW_SITE_ID,
        ),

        listAllSubmissionsByElement(
          webflowToken,
          AUDIT_FORM_ELEMENT_ID,
        ),
      ]);

      const matchingCampaignLeads =
        newestFirst(
          campaignLeadSubmissions.filter(
            submission =>
              matchesEmail(
                submission,
                email,
              ),
          ),
        );

      const matchingMainLeads =
        newestFirst(
          mainLeadSubmissions.filter(
            submission =>
              matchesEmail(
                submission,
                email,
              ),
          ),
        );

      const matchingAudits =
        newestFirst(
          auditSubmissions.filter(
            submission =>
              matchesEmail(
                submission,
                email,
              ),
          ),
        );

      /*
       * Global stable lead_id.
       *
       * Prefer promo if both sites somehow
       * already contain different IDs.
       */
      const campaignLeadId =
        findExistingLeadId(
          matchingCampaignLeads,
        );

      const mainLeadId =
        findExistingLeadId(
          matchingMainLeads,
        );

      const leadId =
        campaignLeadId ||
        mainLeadId ||
        crypto.randomUUID();

      /*
       * Cleanup only records belonging
       * to the site that initiated the flow.
       */
      const leadSubmissionIds =
        source === "main"
          ? matchingMainLeads.map(
              submission =>
                submission.id,
            )
          : matchingCampaignLeads.map(
              submission =>
                submission.id,
            );

      const auditSubmissionIds =
        source === "promo"
          ? matchingAudits.map(
              submission =>
                submission.id,
            )
          : [];

      const cleanupSiteId =
        source === "main"
          ? MAIN_WEBFLOW_SITE_ID
          : WEBFLOW_SITE_ID;

      const cleanupToken =
        await createCleanupToken(
          cleanupSecret,
          leadSubmissionIds,
          auditSubmissionIds,
          cleanupSiteId,
        );

      return json({
        lead_id: leadId,
        cleanup_token: cleanupToken,
      });
    } catch (error) {
      console.error(
        "lead-lookup failed",
        error,
      );

      return json(
        {
          error:
            "Unable to look up the lead.",
        },
        500,
      );
    }
  };
