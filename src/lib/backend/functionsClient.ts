/**
 * Backend Functions client
 *
 * Goal: make deployments portable by allowing routing of backend function calls
 * either to the Supabase Edge Functions backend (default) or to an external HTTP
 * endpoint (configured at deploy time).
 *
 * Env vars (optional):
 * - VITE_FUNCTIONS_BASE_URL: string
 *     Example: https://bywwhnuicnxbfgbcbrxe.supabase.co/functions/v1
 *   If set, calls will be made via fetch(`${base}/${name}`) instead of
 *   supabase.functions.invoke(name).
 *
 * - VITE_FUNCTIONS_BEARER_TOKEN: string (optional)
 *   If set, sends Authorization: Bearer <token> on fetch calls.
 *   (Use only if your external endpoint requires it.)
 */

import { supabase } from '@/integrations/supabase/client';

type InvokeOptions = {
  body?: unknown;
  headers?: Record<string, string>;
};

export type BackendFunctionError = {
  message: string;
  details?: unknown;
};

export async function invokeBackendFunction<TData = any>(
  name: string,
  opts: InvokeOptions = {}
): Promise<{ data: TData | null; error: BackendFunctionError | null }> {
  const baseUrl = (import.meta.env.VITE_FUNCTIONS_BASE_URL as string | undefined)?.trim();

  // Default path: use Supabase Edge Functions via Supabase SDK
  if (!baseUrl) {
    const { data, error } = await supabase.functions.invoke<TData>(name, {
      body: opts.body,
      headers: opts.headers,
    });

    return {
      data: data ?? null,
      error: error ? { message: error.message, details: error } : null,
    };
  }

  // Portable path: call external HTTP endpoint
  const url = `${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(name)}`;
  const bearer = (import.meta.env.VITE_FUNCTIONS_BEARER_TOKEN as string | undefined)?.trim();

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        ...(opts.headers ?? {}),
      },
      body: JSON.stringify(opts.body ?? {}),
    });

    const contentType = resp.headers.get('content-type') ?? '';
    const isJson = contentType.includes('application/json');
    const payload = isJson ? await resp.json() : await resp.text();

    if (!resp.ok) {
      return {
        data: null,
        error: {
          message: `Erro ao chamar função '${name}' (HTTP ${resp.status})`,
          details: payload,
        },
      };
    }

    return { data: payload as TData, error: null };
  } catch (e) {
    return {
      data: null,
      error: { message: `Falha de rede ao chamar função '${name}'`, details: e },
    };
  }
}
