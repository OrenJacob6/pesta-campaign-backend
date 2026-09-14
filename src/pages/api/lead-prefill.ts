export const config = {
  runtime: "edge",
};

import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

import {
  LEAD_FORM_ELEMENT_ID,
  MAIN_LEAD_FORM_ELEMENT_ID,
  MAIN_WEBFLOW_SITE_ID,
} from "../../lib/config";

import {
  json,
} from "../../lib/http";

import {
  listAllSubmissionsByElement,
  type WebflowSubmission,
} from "../../lib/webflow";

type RuntimeEnv = {
  WEBFLOW_API_TOKEN?: string;
  MAIN_WEBFLOW_API_TOKEN?: string;
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

function findMatchingLead(
  submissions: WebflowSubmission[],
  leadId: string,
): WebflowSubmission | undefined {
  return newestFirst(
    submissions.filter(
      submission =>
        String(
          submission
            .formResponse
            ?.lead_id ?? "",
        ).trim() === leadId,
    ),
  )[0];
}

export const POST: APIRoute = async ({
  request,
}) => {
  try {
    const runtimeEnv =
      env as unknown as RuntimeEnv;

    const webflowToken =
      runtimeEnv.WEBFLOW_API_TOKEN;

    const mainWebflowToken =
      runtimeEnv.MAIN_WEBFLOW_API_TOKEN;

    if (
      !webflowToken ||
      !mainWebflowToken
    ) {
      console.error(
        "Required Webflow API tokens are missing.",
      );

      return json(
        {
          error:
            "Server configuration error.",
        },
        500,
      );
    }

    /*
     * Read request body
     */
    let body: {
      lead_id?: unknown;
    };

    try {
      body =
        (await request.json()) as {
          lead_id?: unknown;
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

    const leadId =
      String(
        body.lead_id ?? "",
      ).trim();

    if (!leadId) {
      return json(
        {
          error:
            "lead_id is required.",
        },
        400,
      );
    }

    /*
     * Search Lead Details on both sites.
     */
    const [
      campaignSubmissions,
      mainSubmissions,
    ] = await Promise.all([
      listAllSubmissionsByElement(
        webflowToken,
        LEAD_FORM_ELEMENT_ID,
      ),

      listAllSubmissionsByElement(
        mainWebflowToken,
        MAIN_LEAD_FORM_ELEMENT_ID,
        MAIN_WEBFLOW_SITE_ID,
      ),
    ]);

    /*
     * Prefer promo if the same global lead_id
     * exists on both sites.
     */
    const campaignLead =
      findMatchingLead(
        campaignSubmissions,
        leadId,
      );

    const mainLead =
      findMatchingLead(
        mainSubmissions,
        leadId,
      );

    const lead =
      campaignLead ||
      mainLead;

    if (!lead) {
      return json(
        {
          error:
            "Lead not found.",
        },
        404,
      );
    }

    /*
     * Return only the data required
     * for the Cal.com prefill.
     */
    const firstName =
      String(
        lead.formResponse
          ?.first_name ?? "",
      ).trim();

    const lastName =
      String(
        lead.formResponse
          ?.last_name ?? "",
      ).trim();

    const workEmail =
      String(
        lead.formResponse
          ?.work_email ?? "",
      ).trim();

    /*
     * A lead without the required
     * booking information should not
     * be allowed into the calendar.
     */
    if (
      !firstName ||
      !lastName ||
      !workEmail
    ) {
      console.error(
        "Lead is missing required booking data:",
        leadId,
      );

      return json(
        {
          error:
            "Lead is incomplete.",
        },
        422,
      );
    }

    return json({
      first_name: firstName,
      last_name: lastName,
      work_email: workEmail,
    });

  } catch (error) {
    console.error(
      "lead-prefill failed",
      error,
    );

    return json(
      {
        error:
          "Unable to retrieve lead.",
      },
      500,
    );
  }
};
