import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";
import { UserStorageSchema } from "./schemas/user-storage.schema";

@Module({
  imports: [DatabaseModule.forFeature(UserStorageSchema, "users")],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
