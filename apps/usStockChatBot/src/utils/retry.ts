/**
 * Retries an async function with exponential backoff on 529 (overloaded) errors.
 * Handles both Anthropic and OpenAI-compatible API overload responses.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1000
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const e = err as { status?: number; statusCode?: number; response?: { status?: number }; message?: string };
      const status = e?.status ?? e?.response?.status ?? e?.statusCode;
      const isOverloaded = status === 529 || e?.message?.includes('overloaded');
      if (isOverloaded && attempt < maxRetries - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.warn(`API overloaded (529), retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err as Error;
    }
  }
  throw new Error('Max retries exceeded');
}
