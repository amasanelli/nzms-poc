import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { ZodSerializationError, ZodValidationError } from "../zod/zod.errors";

@Catch(ZodValidationError)
export class ZodExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(ZodExceptionFilter.name);

  catch(exception: ZodValidationError, host: ArgumentsHost) {
    if (exception instanceof ZodSerializationError) {
      this.logger.error(
        `ZodSerializationError: ${exception.message}`,
        exception.issues,
      );
      return super.catch(
        new InternalServerErrorException(exception.message),
        host,
      );
    }

    this.logger.warn(
      `ZodValidationError: ${exception.message}`,
      exception.issues,
    );
    return super.catch(new BadRequestException(exception.message), host);
  }
}
