import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '../../types/kysely.types';
import { dbOrTx } from '../../utils';
import {
  InsertableOAuthAuthorizationCode,
  OAuthAuthorizationCode,
} from '@f-doc/db/types/entity.types';

@Injectable()
export class OAuthAuthorizationCodeRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async insertCode(
    insertableCode: InsertableOAuthAuthorizationCode,
    trx?: KyselyTransaction,
  ): Promise<OAuthAuthorizationCode> {
    const db = dbOrTx(this.db, trx);
    return db
      .insertInto('oauthAuthorizationCodes')
      .values(insertableCode)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Finds a live (unconsumed, unexpired) authorization code by its hash.
   */
  async findValidByHash(
    codeHash: string,
  ): Promise<OAuthAuthorizationCode | undefined> {
    return this.db
      .selectFrom('oauthAuthorizationCodes')
      .selectAll()
      .where('codeHash', '=', codeHash)
      .where('consumedAt', 'is', null)
      .where('expiresAt', '>', new Date())
      .executeTakeFirst();
  }

  async markConsumed(
    codeId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    const db = dbOrTx(this.db, trx);
    await db
      .updateTable('oauthAuthorizationCodes')
      .set({ consumedAt: new Date() })
      .where('id', '=', codeId)
      .execute();
  }
}
