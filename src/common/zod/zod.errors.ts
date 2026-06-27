import { z } from "zod";

/** Thrown when incoming data fails Zod validation. `issues` contains the treeified error shape. */
export class ZodValidationError extends Error {
  readonly issues: ReturnType<typeof z.treeifyError>;

  constructor(readonly zodError: z.ZodError) {
    super("Validation failed");
    this.name = "ZodValidationError";
    this.issues = z.treeifyError(zodError);
  }
}

/** Thrown when a response fails serialization through its attached Zod schema. */
export class ZodSerializationError extends ZodValidationError {
  constructor(error: z.ZodError);
  constructor(error: ZodValidationError);
  constructor(error: z.ZodError | ZodValidationError) {
    super(error instanceof ZodValidationError ? error.zodError : error);
    this.name = "ZodSerializationError";
  }
}
