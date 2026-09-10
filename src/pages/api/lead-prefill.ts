export const config = {
  runtime: "edge",
};

import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

import {
  LEAD_FORM_ELEMENT_ID,
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

export const POST: APIRoute = async ({
  request,
}) => {
  try {
    const runtimeEnv =
      env as unknown as RuntimeEnv;

    const webflowToken =
      runtimeEnv.WEBFLOW_API_TOKEN;

    if (!webflowToken) {
      console.error(
        "WEBFLOW_API_TOKEN is missing."
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
          error: "Invalid JSON body.",
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
          error: "lead_id is required.",
        },
        400,
      );
    }

    /*
     * Get Lead Details submissions
     */
    const submissions =
      await listAllSubmissionsByElement(
        webflowToken,
        LEAD_FORM_ELEMENT_ID,
      );

    /*
     * Find matching lead_id.
     *
     * newestFirst is defensive in case
     * historical duplicates ever exist.
     */
    const matchingLeads =
      newestFirst(
        submissions.filter(
          submission =>
            String(
              submission
                .formResponse
                ?.lead_id ?? "",
            ).trim() === leadId,
        ),
      );

    const lead =
      matchingLeads[0];

    if (!lead) {
      return json(
        {
          error: "Lead not found.",
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
