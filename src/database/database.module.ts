import {
  DynamicModule,
  Inject,
  Module,
  OnApplicationShutdown,
} from "@nestjs/common";
import { MongoClient } from "mongodb";
import { ZodObject, ZodRawShape } from "zod";
import { BaseRepository } from "./database.repository";

export const DATABASE_CONNECTION = "DATABASE_CONNECTION";

export interface DatabaseOptions {
  uri: string;
}

const tokenRegistry = new Map<string, symbol>();

export function getRepositoryToken(collectionName: string): symbol {
  if (!tokenRegistry.has(collectionName)) {
    const token =
      collectionName.toUpperCase().replace(/[^A-Z0-9]+/g, "_") + "_REPOSITORY";
    tokenRegistry.set(collectionName, Symbol(token));
  }
  return tokenRegistry.get(collectionName)!;
}

export const InjectRepository = (collectionName: string) =>
  Inject(getRepositoryToken(collectionName));

@Module({})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly client: MongoClient,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
  }

  static forRoot(options: DatabaseOptions): DynamicModule {
    return {
      global: true,
      module: DatabaseModule,
      providers: [
        {
          provide: DATABASE_CONNECTION,
          useFactory: async (): Promise<MongoClient> => {
            const client = new MongoClient(options.uri);
            await client.connect();
            return client;
          },
        },
      ],
      exports: [DATABASE_CONNECTION],
    };
  }

  static forFeature<TSchema extends ZodObject<ZodRawShape>>(
    schema: TSchema,
    collectionName: string,
  ): DynamicModule {
    const token = getRepositoryToken(collectionName);
    return {
      module: DatabaseModule,
      providers: [
        {
          provide: token,
          useFactory: (client: MongoClient): BaseRepository<TSchema> =>
            new BaseRepository(client.db().collection(collectionName), schema),
          inject: [DATABASE_CONNECTION],
        },
      ],
      exports: [token],
    };
  }
}
