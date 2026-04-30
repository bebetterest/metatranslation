const DEFAULT_LOCAL_OLLAMA_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]']);
const DEFAULT_LOCAL_OLLAMA_PORT = '11434';
const DEFAULT_LOCAL_OLLAMA_PROTOCOL = 'http:';

export function isDefaultLocalOllamaUrl(baseUrl: string): boolean {
  return Boolean(parseDefaultLocalOllamaUrl(baseUrl));
}

export function isDefaultLocalOllamaRootUrl(baseUrl: string): boolean {
  const url = parseDefaultLocalOllamaUrl(baseUrl);
  return Boolean(url && (url.pathname === '' || url.pathname === '/'));
}

export function getDefaultLocalOllamaUrlFilter(baseUrl: string): string {
  const url = parseDefaultLocalOllamaUrl(baseUrl);
  return url ? `|${url.protocol}//${url.host}/` : '';
}

function parseDefaultLocalOllamaUrl(baseUrl: string): URL | null {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }

  if (
    url.protocol !== DEFAULT_LOCAL_OLLAMA_PROTOCOL ||
    url.port !== DEFAULT_LOCAL_OLLAMA_PORT ||
    !DEFAULT_LOCAL_OLLAMA_HOSTS.has(url.hostname)
  ) {
    return null;
  }

  return url;
}
