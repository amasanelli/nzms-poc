import { Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "./database/database.module";
import { UsersModule } from "./users/users.module";
import { RepositoryExceptionFilter } from "./common/filters/filters.repository";
import { ZodExceptionFilter } from "./common/filters/filters.zod";
import { ZodSerializerInterceptor } from "./common/zod/zod.validate.interceptor";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule.forRoot({
      uri: process.env.MONGODB_URI ?? "mongodb://localhost:27017/nzms_poc",
    }),
    UsersModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
    { provide: APP_FILTER, useClass: ZodExceptionFilter },
    { provide: APP_FILTER, useClass: RepositoryExceptionFilter },
  ],
})
export class AppModule {}
