export type RequestFn = <T = unknown>(
  path: string,
  options?: RequestInit,
  retryOnUnauthorized?: boolean
) => Promise<T>;

export interface ApiContext {
  request: RequestFn;
  appendAccessToken: (url: string) => string;
  appendQuery: (
    url: string,
    params: Record<string, string | number | undefined>
  ) => string;
  getApiBase: () => string;
}
