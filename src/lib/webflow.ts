import { WEBFLOW_SITE_ID } from "./config";

const API_BASE = "https://api.webflow.com/v2";

export type WebflowSubmission = {
  id: string;
  dateSubmitted?: string;
  formResponse?: Record<string, unknown>;
};

type ListResponse = {
  formSubmissions?: WebflowSubmission[];
  pagination?: {
    limit?: number;
    offset?: number;
    total?: number;
  };
};

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
}

export async function listAllSubmissionsByElement(
  token: string,
  elementId: string,
): Promise<WebflowSubmission[]> {
  const results: WebflowSubmission[] = [];
  const limit = 100;
  let offset = 0;

  while (true) {
    const url = new URL(
      `${API_BASE}/sites/${WEBFLOW_SITE_ID}/form_submissions`,
    );

    url.searchParams.set("elementId", elementId);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));

    const response = await fetch(url, {
      method: "GET",
      headers: headers(token),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Webflow list submissions failed (${response.status}): ${body}`,
      );
    }

    const data = (await response.json()) as ListResponse;
    const page = data.formSubmissions ?? [];

    results.push(...page);

    const total = data.pagination?.total ?? results.length;

    if (results.length >= total || page.length < limit) {
      break;
    }

    offset += page.length;
  }

  return results;
}

export async function deleteSubmission(
  token: string,
  submissionId: string,
): Promise<void> {
  const response = await fetch(
    `${API_BASE}/sites/${WEBFLOW_SITE_ID}/form_submissions/${encodeURIComponent(submissionId)}`,
    {
      method: "DELETE",
      headers: headers(token),
    },
  );

  // Treat already-deleted submissions as success so cleanup is idempotent.
  if (response.status === 404) {
    return;
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Webflow delete submission failed (${response.status}): ${body}`,
    );
  }
}
