import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '../../types/kysely.types';
import { dbOrTx } from '../../utils';
import {
  InsertableOAuthToken,
  OAuthToken,
} from '@f-doc/db/types/entity.types';

@Injectable()
export class OAuthTokenRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async insertToken(
    insertableToken: InsertableOAuthToken,
    trx?: KyselyTransaction,
  ): Promise<OAuthToken> {
    const db = dbOrTx(this.db, trx);
    return db
      .insertInto('oauthTokens')
      .values(insertableToken)
      .returningAll()
      .executeTakeFirst();
  }

  async findByJti(jti: string): Promise<OAuthToken | undefined> {
    return this.db
      .selectFrom('oauthTokens')
      .selectAll()
      .where('accessTokenJti', '=', jti)
      .executeTakeFirst();
  }

  /**
   * Finds a live (unrevoked, unexpired) refresh token by its hash.
   */
  async findValidByRefreshTokenHash(
    refreshTokenHash: string,
  ): Promise<OAuthToken | undefined> {
    return this.db
      .selectFrom('oauthTokens')
      .selectAll()
      .where('refreshTokenHash', '=', refreshTokenHash)
      .where('revokedAt', 'is', null)
      .where('refreshExpiresAt', '>', new Date())
      .executeTakeFirst();
  }

  async revoke(tokenId: string, trx?: KyselyTransaction): Promise<void> {
    const db = dbOrTx(this.db, trx);
    await db
      .updateTable('oauthTokens')
      .set({ revokedAt: new Date() })
      .where('id', '=', tokenId)
      .execute();
  }

  async revokeByGrantId(
    grantId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    const db = dbOrTx(this.db, trx);
    await db
      .updateTable('oauthTokens')
      .set({ revokedAt: new Date() })
      .where('grantId', '=', grantId)
      .where('revokedAt', 'is', null)
      .execute();
  }
}
