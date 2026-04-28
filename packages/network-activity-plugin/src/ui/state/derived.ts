import { memoize } from 'proxy-memoize';
import { NetworkActivityState } from './store';
import {
  ProcessedRequest,
  HttpNetworkEntry,
  WebSocketNetworkEntry,
  SSENetworkEntry,
} from './model';

const GQL_OPERATION_RE = /^\s*(query|mutation|subscription)\s+(\w+)/m;
const GQL_ANONYMOUS_RE = /^\s*(query|mutation|subscription)\b/m;

type GraphQLOperation = {
  name: string;
  type: 'query' | 'mutation' | 'subscription';
} | null;

const extractGqlOperationFromQuery = (gqlQuery: string, operationName?: string): GraphQLOperation => {
  const namedMatch = GQL_OPERATION_RE.exec(gqlQuery);
  if (namedMatch) {
    return {
      type: namedMatch[1] as 'query' | 'mutation' | 'subscription',
      name: operationName ?? namedMatch[2],
    };
  }
  const anonymousMatch = GQL_ANONYMOUS_RE.exec(gqlQuery);
  if (anonymousMatch) {
    return {
      type: anonymousMatch[1] as 'query' | 'mutation' | 'subscription',
      name: operationName ?? 'Anonymous',
    };
  }
  return null;
};

const extractGraphQLOperation = (
  postData: HttpNetworkEntry['request']['body'] | undefined,
  url: string,
): GraphQLOperation => {
  try {
    // POST: parse from JSON body
    if (postData && postData.type === 'application/json') {
      const rawData = postData.data;
      const jsonString =
        typeof rawData === 'string'
          ? rawData
          : typeof rawData === 'object' && rawData !== null && 'value' in rawData && typeof (rawData as { value: unknown }).value === 'string'
            ? (rawData as { value: string }).value
            : null;
      if (jsonString) {
        const body = JSON.parse(jsonString);
        if (typeof body === 'object' && body?.query) {
          return extractGqlOperationFromQuery(body.query as string, body.operationName as string | undefined);
        }
      }
    }

    // GET: parse from ?query= URL param (used by graphql-yoga SSE subscriptions)
    const { searchParams } = new URL(url);
    const queryParam = searchParams.get('query');
    if (queryParam) {
      const decoded = decodeURIComponent(queryParam);
      // may be raw GQL string or JSON-encoded { query, operationName }
      try {
        const parsed = JSON.parse(decoded);
        if (typeof parsed === 'object' && parsed?.query) {
          return extractGqlOperationFromQuery(parsed.query as string, parsed.operationName as string | undefined);
        }
      } catch {
        // raw GQL string
        return extractGqlOperationFromQuery(decoded);
      }
    }

    return null;
  } catch {
    return null;
  }
};

export const getProcessedRequests = memoize((state: NetworkActivityState) => {
  const { networkEntries } = state;
  const requests: ProcessedRequest[] = [];

  for (const entry of networkEntries.values()) {
    if (entry.type === 'http') {
      const httpEntry = entry as HttpNetworkEntry;
      const gqlOp = extractGraphQLOperation(httpEntry.request.body, httpEntry.request.url);
      requests.push({
        id: httpEntry.id,
        type: 'http',
        name: httpEntry.request.url,
        graphqlOperationName: gqlOp?.name,
        graphqlOperationType: gqlOp?.type,
        status: httpEntry.status,
        timestamp: httpEntry.timestamp,
        duration: httpEntry.duration,
        size: httpEntry.size ?? null,
        method: httpEntry.request.method,
        httpStatus: httpEntry.response?.status,
        progress: httpEntry.progress,
      });
    } else if (entry.type === 'websocket') {
      const wsEntry = entry as WebSocketNetworkEntry;
      requests.push({
        id: wsEntry.id,
        type: 'websocket',
        name: wsEntry.connection.url,
        graphqlOperationName: wsEntry.graphqlOperationName,
        graphqlOperationType: wsEntry.graphqlOperationType,
        status: wsEntry.status,
        timestamp: wsEntry.timestamp,
        duration: wsEntry.duration,
        size: null,
        method: 'WS',
        httpStatus: 0,
      });
    } else if (entry.type === 'sse') {
      const sseEntry = entry as SSENetworkEntry;
      const sseGqlOp = extractGraphQLOperation(undefined, sseEntry.request.url);
      requests.push({
        id: sseEntry.id,
        type: 'sse',
        name: sseEntry.request.url,
        graphqlOperationName: sseGqlOp?.name,
        graphqlOperationType: sseGqlOp?.type,
        status: sseEntry.status,
        timestamp: sseEntry.timestamp,
        duration: sseEntry.duration,
        size: null,
        method: 'SSE',
        httpStatus: 0,
      });
    }
  }

  return requests.sort((a, b) => b.timestamp - a.timestamp);
});

export const getSelectedRequest = memoize((state: NetworkActivityState) => {
  const { selectedRequestId, networkEntries } = state;
  if (!selectedRequestId) return null;
  return networkEntries.get(selectedRequestId) || null;
});

export const getRequestSummary = (
  requestId: string,
): ((state: NetworkActivityState) => ProcessedRequest | null) =>
  memoize((state: NetworkActivityState) => {
    const { networkEntries } = state;
    const entry = networkEntries.get(requestId);
    if (!entry) return null;

    if (entry.type === 'http') {
      const httpEntry = entry as HttpNetworkEntry;
      return {
        id: httpEntry.id,
        type: 'http',
        name: httpEntry.request.url,
        status: httpEntry.status,
        timestamp: httpEntry.timestamp,
        duration: httpEntry.duration,
        size: httpEntry.size ?? null,
        method: httpEntry.request.method,
        httpStatus: httpEntry.response?.status || 0,
        progress: httpEntry.progress,
      };
    } else if (entry.type === 'websocket') {
      const wsEntry = entry as WebSocketNetworkEntry;
      return {
        id: wsEntry.id,
        type: 'websocket',
        name: wsEntry.connection.url,
        status: wsEntry.status,
        timestamp: wsEntry.timestamp,
        duration: wsEntry.duration,
        size: null,
        method: 'WS',
        httpStatus: 0,
      };
    } else if (entry.type === 'sse') {
      const sseEntry = entry as SSENetworkEntry;
      return {
        id: sseEntry.id,
        type: 'sse',
        name: sseEntry.request.url,
        status: sseEntry.status,
        timestamp: sseEntry.timestamp,
        duration: sseEntry.duration,
        size: null,
        method: 'SSE',
        httpStatus: 0,
      };
    }

    return null;
  });
