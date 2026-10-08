// Typed failures so the UI can show a specific, friendly message per cause.

export type WebsErrorCode =
  | 'kb-empty'
  | 'ollama-offline'
  | 'ollama-timeout'
  | 'ollama-error'
  | 'bad-json'
  | 'cancelled';

export class WebsError extends Error {
  constructor(public code: WebsErrorCode, message: string) {
    super(message);
    this.name = 'WebsError';
  }
}
