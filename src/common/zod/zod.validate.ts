import { z } from "zod";
import { ZodValidationError } from "./zod.errors";

/** Parses `data` against `schema`. Throws {@link ZodValidationError} on failure. */
export function zodValidate<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) throw new ZodValidationError(result.error);
  return result.data;
}
