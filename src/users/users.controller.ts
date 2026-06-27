import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiBadRequestResponse,
} from "@nestjs/swagger";
import { UsersService } from "./users.service";
import {
  CreateUserSchema,
  UpdateUserSchema,
  UserResponseSchema,
  UserResponseListSchema,
  CreateUserInput,
  UpdateUserInput,
} from "./schemas/user-controller.schema";
import { ZodBody } from "../common/zod/zod.validate.pipe";
import { ZodSerializer } from "../common/zod/zod.validate.interceptor";
import { ZodApiBody, ZodApiResponse } from "../common/zod/zod.swagger";

@ApiTags("users")
@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ZodSerializer(UserResponseSchema)
  @ApiOperation({ summary: "Create user" })
  @ZodApiBody(CreateUserSchema)
  @ZodApiResponse(201, UserResponseSchema)
  @ApiBadRequestResponse({ description: "Validation failed" })
  create(@ZodBody(CreateUserSchema) dto: CreateUserInput) {
    return this.usersService.create(dto);
  }

  @Get()
  @ZodSerializer(UserResponseListSchema)
  @ApiOperation({ summary: "List all users" })
  @ZodApiResponse(200, UserResponseListSchema)
  findAll() {
    return this.usersService.findAll();
  }

  @Get(":id")
  @ZodSerializer(UserResponseSchema)
  @ApiOperation({ summary: "Get user by id" })
  @ApiParam({ name: "id", description: "MongoDB ObjectId" })
  @ZodApiResponse(200, UserResponseSchema)
  @ApiNotFoundResponse({ description: "User not found" })
  findOne(@Param("id") id: string) {
    return this.usersService.findById(id);
  }

  @Patch(":id")
  @ZodSerializer(UserResponseSchema)
  @ApiOperation({ summary: "Partial update user" })
  @ApiParam({ name: "id", description: "MongoDB ObjectId" })
  @ZodApiBody(UpdateUserSchema)
  @ZodApiResponse(200, UserResponseSchema)
  @ApiNotFoundResponse({ description: "User not found" })
  @ApiBadRequestResponse({ description: "Validation failed" })
  update(
    @Param("id") id: string,
    @ZodBody(UpdateUserSchema) dto: UpdateUserInput,
  ) {
    return this.usersService.update(id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete user" })
  @ApiParam({ name: "id", description: "MongoDB ObjectId" })
  @ApiNoContentResponse({ description: "User deleted" })
  @ApiNotFoundResponse({ description: "User not found" })
  remove(@Param("id") id: string) {
    return this.usersService.remove(id);
  }
}
