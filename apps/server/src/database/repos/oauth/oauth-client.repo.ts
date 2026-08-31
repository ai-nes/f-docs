import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '../../types/kysely.types';
import { dbOrTx } from '../../utils';
import {
  InsertableOAuthClient,
  OAuthClient,
  UpdatableOAuthClient,
} from '@f-doc/db/types/entity.types';

@Injectable()
export class OAuthClientRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async findById(clientId: string): Promise<OAuthClient | undefined> {
    return this.db
      .selectFrom('oauthClients')
      .selectAll()
      .where('id', '=', clientId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  async findByIdAndWorkspace(
    clientId: string,
    workspaceId: string,
  ): Promise<OAuthClient | undefined> {
    return this.db
      .selectFrom('oauthClients')
      .selectAll()
      .where('id', '=', clientId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  async insertClient(
    insertableClient: InsertableOAuthClient,
    trx?: KyselyTransaction,
  ): Promise<OAuthClient> {
    const db = dbOrTx(this.db, trx);
    return db
      .insertInto('oauthClients')
      .values(insertableClient)
      .returningAll()
      .executeTakeFirst();
  }

  async updateClient(
    updatableClient: UpdatableOAuthClient,
    clientId: string,
    trx?: KyselyTransaction,
  ): Promise<OAuthClient> {
    const db = dbOrTx(this.db, trx);
    return db
      .updateTable('oauthClients')
      .set({ ...updatableClient, updatedAt: new Date() })
      .where('id', '=', clientId)
      .returningAll()
      .executeTakeFirst();
  }
}
