import queryString from "query-string";

export function buildUrl(baseUrl, path, query) {
  const qs = query ? `?${queryString.stringify(query)}` : "";

  return `${baseUrl}${path}${qs}`;
}
