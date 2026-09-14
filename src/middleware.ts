import { defineMiddleware } from "astro:middleware";

const ALLOWED_ORIGINS = new Set([
  "https://pesta.io",
  "https://www.pesta.io",
  "https://promo.pesta.io",
  "https://www.promo.pesta.io",
]);

function getCorsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

export const onRequest = defineMiddleware(
  async ({ request }, next) => {
    const origin =
      request.headers.get("Origin");

    /*
     * If an Origin header exists,
     * only allow known Pesta domains.
     *
     * Requests without Origin are still
     * allowed for server-to-server usage.
     */
    if (
      origin &&
      !ALLOWED_ORIGINS.has(origin)
    ) {
      return new Response(
        JSON.stringify({
          error: "Origin not allowed.",
        }),
        {
          status: 403,
          headers: {
            "Content-Type":
              "application/json",
          },
        }
      );
    }

    /*
     * Handle browser CORS preflight.
     */
    if (
      request.method === "OPTIONS"
    ) {
      if (!origin) {
        return new Response(null, {
          status: 204,
        });
      }

      return new Response(null, {
        status: 204,
        headers:
          getCorsHeaders(origin),
      });
    }

    const response = await next();

    /*
     * Add CORS headers to the
     * actual response as well.
     */
    if (!origin) {
      return response;
    }

    const headers =
      new Headers(response.headers);

    const corsHeaders =
      getCorsHeaders(origin);

    Object.entries(corsHeaders)
      .forEach(([key, value]) => {
        headers.set(key, value);
      });

    return new Response(
      response.body,
      {
        status: response.status,
        statusText:
          response.statusText,
        headers,
      }
    );
  }
);
