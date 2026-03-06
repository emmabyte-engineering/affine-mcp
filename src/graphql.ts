import type { AffineConfig } from "./config.js";
import { getAuthHeaders } from "./auth.js";

export class GraphQLClient {
  private endpoint: string;
  private headers: Record<string, string>;

  constructor(config: AffineConfig, cookie?: string) {
    this.endpoint = `${config.baseUrl}/graphql`;
    this.headers = {
      "Content-Type": "application/json",
      ...getAuthHeaders(config, cookie),
    };
  }

  setCookie(cookie: string) {
    this.headers["Cookie"] = cookie;
  }

  async query<T = any>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      throw new Error(`GraphQL request failed: ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (json.errors?.length) {
      throw new Error(`GraphQL errors: ${json.errors.map((e) => e.message).join(", ")}`);
    }
    if (!json.data) {
      throw new Error("GraphQL response missing data");
    }
    return json.data;
  }
}

// --- Queries ---

export const LIST_WORKSPACES = `
  query { workspaces { id public createdAt } }
`;

export const GET_WORKSPACE = `
  query GetWorkspace($id: String!) {
    workspace(id: $id) { id public createdAt }
  }
`;

export const LIST_DOCS = `
  query ListDocs($workspaceId: String!, $first: Int, $after: String) {
    workspace(id: $workspaceId) {
      docs(pagination: { first: $first, after: $after }) {
        totalCount
        pageInfo { hasNextPage endCursor }
        edges {
          cursor
          node { id title summary createdAt updatedAt }
        }
      }
    }
  }
`;

export const GET_DOC = `
  query GetDoc($workspaceId: String!, $docId: String!) {
    workspace(id: $workspaceId) {
      doc(docId: $docId) { id title summary createdAt updatedAt }
    }
  }
`;

export const GET_COMMENTS = `
  query GetComments($workspaceId: String!, $docId: String!, $first: Int, $after: String) {
    workspace(id: $workspaceId) {
      comments(docId: $docId, pagination: { first: $first, after: $after }) {
        totalCount
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            content
            resolved
            createdAt
            updatedAt
            user { id name avatarUrl }
            replies {
              id
              content
              createdAt
              updatedAt
              user { id name avatarUrl }
            }
          }
        }
      }
    }
  }
`;
