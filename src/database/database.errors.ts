import { ZodValidationError } from "../common/zod/zod.errors";

/** Base class for all repository-related errors in this application. */
export class RepositoryError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "RepositoryError";
  }
}

/** Thrown when a document matching the given filter does not exist. */
export class NotFoundError extends RepositoryError {
  constructor() {
    super("Document not found");
    this.name = "NotFoundError";
  }
}

/** Thrown when a string cannot be parsed into a valid ObjectId. */
export class InvalidIdError extends RepositoryError {
  constructor(id: string) {
    super(`Invalid id: ${id}`);
    this.name = "InvalidIdError";
  }
}

/** Wraps a {@link ZodValidationError} thrown inside the repository layer as a {@link RepositoryError}. */
export class ZodRepositoryError extends RepositoryError {
  constructor(readonly error: ZodValidationError) {
    super(error.message);
    this.name = "ZodRepositoryError";
  }
}
