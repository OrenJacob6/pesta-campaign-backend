export const config = {
  runtime: "edge",
};

import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

import {
  verifyCleanupToken,
} from "../../lib/cleanup-token";

import {
  json,
} from "../../lib/http";

import {
  deleteSubmission,
} from "../../lib/webflow";

import {
  MAIN_WEBFLOW_SITE_ID,
  WEBFLOW_SITE_ID,
} from "../../lib/config";

type RuntimeEnv = {
  WEBFLOW_API_TOKEN?: string;
  MAIN_WEBFLOW_API_TOKEN?: string;
  CLEANUP_SECRET?: string;
};

export const POST: APIRoute =
  async ({ request }) => {
    try {
      const runtimeEnv =
        env as unknown as RuntimeEnv;

      const webflowToken =
        runtimeEnv.WEBFLOW_API_TOKEN;

      const mainWebflowToken =
        runtimeEnv.MAIN_WEBFLOW_API_TOKEN;

      const cleanupSecret =
        runtimeEnv.CLEANUP_SECRET;

      if (!cleanupSecret) {
        console.error(
          "CLEANUP_SECRET is missing.",
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
        cleanup_token?: unknown;
      };

      try {
        body =
          (await request.json()) as {
            cleanup_token?: unknown;
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

      const cleanupToken =
        String(
          body.cleanup_token ?? "",
        ).trim();

      if (!cleanupToken) {
        return json(
          {
            error:
              "cleanup_token is required.",
          },
          400,
        );
      }

      let payload;

      try {
        payload =
          await verifyCleanupToken(
            cleanupSecret,
            cleanupToken,
          );
      } catch {
        return json(
          {
            error:
              "Invalid or expired cleanup token.",
          },
          401,
        );
      }

      /*
       * Old tokens created before multi-site cleanup
       * did not contain siteId, so default them to promo.
       */
      const siteId =
        payload.siteId ||
        WEBFLOW_SITE_ID;

      if (
        siteId !== WEBFLOW_SITE_ID &&
        siteId !== MAIN_WEBFLOW_SITE_ID
      ) {
        return json(
          {
            error:
              "Cleanup site is not allowed.",
          },
          400,
        );
      }

      /*
       * Use the Site API token that belongs
       * to the site being cleaned.
       */
      const selectedWebflowToken =
        siteId === MAIN_WEBFLOW_SITE_ID
          ? mainWebflowToken
          : webflowToken;

      if (!selectedWebflowToken) {
        console.error(
          `Webflow API token is missing for site ${siteId}.`,
        );

        return json(
          {
            error:
              "Server configuration error.",
          },
          500,
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
       * Delete sequentially to keep outbound
       * request concurrency predictable.
       */
      for (const submissionId of ids) {
        await deleteSubmission(
          selectedWebflowToken,
          submissionId,
          siteId,
        );

        deleted += 1;
      }

      return json({
        ok: true,
        deleted,
      });
    } catch (error) {
      console.error(
        "delete-old-submissions failed",
        error,
      );

      /*
       * New submissions already exist by the time
       * this endpoint runs, so cleanup failure should
       * not tell the visitor their lead was lost.
       */
      return json(
        {
          error:
            "Unable to clean up old submissions.",
        },
        500,
      );
    }
  };
