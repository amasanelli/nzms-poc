import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import {
  InvalidIdError,
  NotFoundError,
  RepositoryError,
  ZodRepositoryError,
} from "../../database/database.errors";

@Catch(RepositoryError)
export class RepositoryExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(RepositoryExceptionFilter.name);

  catch(exception: RepositoryError, host: ArgumentsHost) {
    if (exception instanceof ZodRepositoryError) {
      this.logger.error(
        `ZodRepositoryError: ${exception.message}`,
        exception.error.issues,
      );
      return super.catch(
        new InternalServerErrorException(exception.message),
        host,
      );
    }

    if (exception instanceof NotFoundError) {
      this.logger.warn(`NotFoundError: ${exception.message}`);
      return super.catch(new NotFoundException(exception.message), host);
    }

    if (exception instanceof InvalidIdError) {
      this.logger.warn(`InvalidIdError: ${exception.message}`);
      return super.catch(new BadRequestException(exception.message), host);
    }

    this.logger.error(`RepositoryError: ${exception.message}`);
    return super.catch(new InternalServerErrorException(), host);
  }
}
