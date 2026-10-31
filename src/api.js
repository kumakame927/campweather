const SERVICES = {
  'api.open-meteo.com': { name: 'Open-Meteo', prefix: 'open-meteo' },
  'nominatim.openstreetmap.org': { name: 'Nominatim', prefix: 'nominatim' },
};
export const usesSameOrigin = Boolean(import.meta.env?.DEV || import.meta.env?.VITE_API_TRANSPORT === 'same-origin');
export function requestTarget(input, sameOrigin = usesSameOrigin) {
  const url = new URL(input);
  const service = SERVICES[url.hostname];
  // Vite を通さない静的プレビューでは import.meta.env は未定義。
  const transport = sameOrigin && service ? `${import.meta.env?.BASE_URL ?? '/'}api/${service.prefix}${url.pathname}${url.search}` : url.href;
  return { url: transport, service: service?.name ?? url.hostname, endpoint: `${url.origin}${url.pathname}` };
}
export class ApiError extends Error {
  constructor(message, { code, service, endpoint, status } = {}) {
    super(`${service ? `${service}: ` : ''}${message}`);
    this.name = 'ApiError';
    Object.assign(this, { code, service, endpoint, status });
  }
}
