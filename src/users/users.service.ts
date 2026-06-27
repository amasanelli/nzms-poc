import { Injectable } from "@nestjs/common";
import { ObjectId } from "mongodb";
import { InjectRepository } from "../database/database.module";
import { ZodValidate } from "../common/zod/zod.validate.decorator";
import { UserSchema, User } from "./schemas/user-service.schema";
import { UserResponse } from "./schemas/user-controller.schema";
import { UserDocument, UsersRepository } from "./schemas/user-storage.schema";
import { NotFoundError } from "../database/database.errors";

const toAge = (yearOfBirth: number) => new Date().getFullYear() - yearOfBirth;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository("users") private readonly repo: UsersRepository,
  ) {}

  async create(@ZodValidate(UserSchema) data: User): Promise<UserResponse> {
    const { yearOfBirth, ...rest } = data;
    const now = new Date();
    const doc = {
      _id: new ObjectId(),
      ...rest,
      age: toAge(yearOfBirth),
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.insertOne(doc);
    return this.toResponse(doc);
  }

  async findAll(): Promise<UserResponse[]> {
    const docs = await this.repo.find();
    return docs.map((d) => this.toResponse(d));
  }

  async findById(id: string): Promise<UserResponse> {
    const doc = await this.repo.findOne({ _id: this.repo.parseId(id) });
    return this.toResponse(doc);
  }

  async update(
    id: string,
    @ZodValidate(UserSchema.partial()) data: Partial<User>,
  ): Promise<UserResponse> {
    const { yearOfBirth, ...rest } = data;
    const patch: Record<string, unknown> = { ...rest, updatedAt: new Date() };
    if (yearOfBirth !== undefined) patch.age = toAge(yearOfBirth);
    const objectId = this.repo.parseId(id);
    const doc = await this.repo.findOneAndUpdate({ _id: objectId }, patch);
    return this.toResponse(doc);
  }

  async remove(id: string): Promise<void> {
    const result = await this.repo.deleteOne({ _id: this.repo.parseId(id) });
    if (result.deletedCount === 0) throw new NotFoundError();
  }

  private toResponse(doc: UserDocument): UserResponse {
    return {
      id: doc._id.toString(),
      name: doc.name,
      email: doc.email,
      age: doc.age,
      role: doc.role,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}
