import { Injectable, UnauthorizedException } from '@nestjs/common';
import { OAuthTokenRepo } from '../../../database/repos/oauth/oauth-token.repo';
import { OAuthGrantRepo } from '../../../database/repos/oauth/oauth-grant.repo';
import { UserRepo } from '@f-doc/db/repos/user/user.repo';
import { WorkspaceRepo } from '@f-doc/db/repos/workspace/workspace.repo';
import { User, Workspace } from '@f-doc/db/types/entity.types';
import { JwtOAuthPayload } from '../../../core/auth/dto/jwt-payload';
import { isUserDisabled } from '../../../common/helpers';

export interface OAuthValidationResult {
  user: User;
  workspace: Workspace;
  oauth: { scopes: string[]; grantId: string };
}

/**
 * Validates OAuth access-token JWTs on behalf of `JwtStrategy`
 * (apps/server/src/core/auth/strategies/jwt.strategy.ts), which resolves
 * this class via ModuleRef at the hardcoded require path
 * `./../../../ee/oauth/services/oauth-strategy.service` -- do not move this
 * file.
 */
@Injectable()
export class OAuthStrategyService {
  constructor(
    private readonly oauthTokenRepo: OAuthTokenRepo,
    private readonly oauthGrantRepo: OAuthGrantRepo,
    private readonly userRepo: UserRepo,
    private readonly workspaceRepo: WorkspaceRepo,
  ) {}

  async validateOAuthToken(
    payload: JwtOAuthPayload,
    ctx: { workspaceId: string; host: string },
  ): Promise<OAuthValidationResult> {
    const token = await this.oauthTokenRepo.findByJti(payload.jti);

    if (!token || token.revokedAt) {
      throw new UnauthorizedException('OAuth token revoked or not found');
    }

    if (new Date(token.accessExpiresAt).getTime() <= Date.now()) {
      throw new UnauthorizedException('OAuth token expired');
    }

    const grant = await this.oauthGrantRepo.findById(token.grantId);
    if (!grant || grant.revokedAt) {
      throw new UnauthorizedException('OAuth grant revoked or not found');
    }

    if (
      grant.id !== payload.grantId ||
      grant.workspaceId !== payload.workspaceId ||
      token.workspaceId !== payload.workspaceId
    ) {
      throw new UnauthorizedException('OAuth token workspace mismatch');
    }

    if (ctx.workspaceId && ctx.workspaceId !== payload.workspaceId) {
      throw new UnauthorizedException('Workspace does not match');
    }

    const workspace = await this.workspaceRepo.findById(payload.workspaceId);
    if (!workspace) {
      throw new UnauthorizedException('Workspace not found');
    }

    const user = await this.userRepo.findById(
      grant.userId,
      payload.workspaceId,
    );
    if (!user || isUserDisabled(user)) {
      throw new UnauthorizedException('User not found or disabled');
    }

    return {
      user,
      workspace,
      oauth: {
        scopes: (payload.scope ?? '').split(' ').filter(Boolean),
        grantId: payload.grantId,
      },
    };
  }
}
