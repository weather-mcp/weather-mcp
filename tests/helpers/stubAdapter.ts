/**
 * Stub adapter for an axios instance — reaches the real interceptor via axios's own `settle`,
 * and records every request config the adapter receives.
 */

import type { AxiosInstance } from 'axios';
import { AxiosError } from 'axios';
// eslint-disable-next-line import/no-unresolved -- axios's own unsafe subpath export, verified live in node_modules
import settle from 'axios/unsafe/core/settle.js';

export type Answer = { status: number; data?: unknown } | { code: string };

export interface RecordedRequest {
  url: string | undefined;
  baseURL: string | undefined;
  params: Record<string, unknown> | undefined;
}

export function stubAdapter(client: AxiosInstance, answer: Answer): RecordedRequest[] {
  const recorded: RecordedRequest[] = [];
  client.defaults.adapter = (config) =>
    new Promise((resolve, reject) => {
      recorded.push({ url: config.url, baseURL: config.baseURL, params: config.params });
      if ('code' in answer) {
        reject(new AxiosError(`connect ${answer.code}`, answer.code, config));
        return;
      }
      settle(resolve, reject, {
        status: answer.status,
        statusText: '',
        headers: {},
        data: answer.data,
        config,
        request: {},
      });
    });
  return recorded;
}
