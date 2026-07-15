import { z } from 'zod';

// FE(se-dot-field) shared/api/client.ts 의 ApiError 규약과 동일하게 유지할 것.
export const apiErrorKind = z.enum([
  'network',
  'http',
  'parse',
  'unauthorized',
  'forbidden',
  'not-wired',
  'validation',
]);

export const apiError = z.object({
  kind: apiErrorKind,
  status: z.number().optional(),
  message: z.string(),
});

export type ApiError = z.infer<typeof apiError>;
