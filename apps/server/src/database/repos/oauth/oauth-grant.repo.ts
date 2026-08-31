import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '../../types/kysely.types';
import { dbOrTx } from '../../utils';
import { OAuthGrant } from '@f-doc/db/types/entity.types';

@Injectable()
export class OAuthGrantRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async findById(grantId: string): Promise<OAuthGrant | undefined> {
    return this.db
      .selectFrom('oauthGrants')
      .selectAll()
      .where('id', '=', grantId)
      .executeTakeFirst();
  }

  async findActiveByUserAndClient(
    userId: string,
    clientId: string,
  ): Promise<OAuthGrant | undefined> {
    return this.db
      .selectFrom('oauthGrants')
      .selectAll()
      .where('userId', '=', userId)
      .where('clientId', '=', clientId)
      .where('revokedAt', 'is', null)
      .executeTakeFirst();
  }

  /**
   * Finds the (userId, clientId) grant if it exists and is unrevoked, and
   * either creates a new grant with the given scopes or unions the newly
   * requested scopes into the existing grant's scope set.
   */
  async findOrCreateGrant(
    opts: {
      userId: string;
      clientId: string;
      workspaceId: string;
      scopes: string[];
    },
    trx?: KyselyTransaction,
  ): Promise<OAuthGrant> {
    const db = dbOrTx(this.db, trx);
    const { userId, clientId, workspaceId, scopes } = opts;

    const existing = await db
      .selectFrom('oauthGrants')
      .selectAll()
      .where('userId', '=', userId)
      .where('clientId', '=', clientId)
      .executeTakeFirst();

    if (existing) {
      const existingScopes = Array.isArray(existing.scopes)
        ? (existing.scopes as string[])
        : [];
      const mergedScopes = Array.from(
        new Set([...existingScopes, ...scopes]),
      );

      return db
        .updateTable('oauthGrants')
        .set({
          scopes: mergedScopes,
          revokedAt: null,
          updatedAt: new Date(),
          lastUsedAt: new Date(),
        })
        .where('id', '=', existing.id)
        .returningAll()
        .executeTakeFirst();
    }

    return db
      .insertInto('oauthGrants')
      .values({
        userId,
        clientId,
        workspaceId,
        scopes,
        lastUsedAt: new Date(),
      })
      .returningAll()
      .executeTakeFirst();
  }

  async touchLastUsed(grantId: string, trx?: KyselyTransaction): Promise<void> {
    const db = dbOrTx(this.db, trx);
    await db
      .updateTable('oauthGrants')
      .set({ lastUsedAt: new Date() })
      .where('id', '=', grantId)
      .execute();
  }

  async revoke(grantId: string, trx?: KyselyTransaction): Promise<void> {
    const db = dbOrTx(this.db, trx);
    await db
      .updateTable('oauthGrants')
      .set({ revokedAt: new Date() })
      .where('id', '=', grantId)
      .execute();
  }
}
