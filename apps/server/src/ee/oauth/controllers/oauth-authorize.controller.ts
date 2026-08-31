import {
  Controller,
  Get,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RequireSessionAuth } from '../../../common/decorators/require-session-auth.decorator';
import { SkipTransform } from '../../../common/decorators/skip-transform.decorator';
import { AuthUser } from '../../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../../common/decorators/auth-workspace.decorator';
import { AuthorizeDto } from '../dto/authorize.dto';
import { OAuthError, OAuthService } from '../services/oauth.service';
import { User, Workspace } from '@f-doc/db/types/entity.types';

/**
 * GET /oauth/authorize -- the authorization-code "grant" step.
 *
 * Requires an interactive F-Doc session (@RequireSessionAuth ensures this
 * cannot be satisfied by an API key or another OAuth token). This is an
 * auto-approve flow: reaching this endpoint while logged in immediately
 * issues a code and redirects back to the client. There is intentionally
 * no consent screen in this implementation -- see OAuthService.authorize()
 * doc comment and the final report for the production follow-up this
 * implies (show client name + requested scopes, require explicit Allow).
 */
@UseGuards(JwtAuthGuard)
@Controller('oauth')
export class OAuthAuthorizeController {
  constructor(private readonly oauthService: OAuthService) {}

  @RequireSessionAuth()
  @SkipTransform()
  @Get('authorize')
  async authorize(
    @Query() query: AuthorizeDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Req() req: FastifyRequest,
    @Res({ passthrough: false }) res: FastifyReply,
  ) {
    try {
      const { code } = await this.oauthService.authorize({
        workspaceId: workspace.id,
        userId: user.id,
        clientId: query.client_id,
        redirectUri: query.redirect_uri,
        codeChallenge: query.code_challenge,
        codeChallengeMethod: query.code_challenge_method,
        scope: query.scope,
      });

      const redirectUrl = new URL(query.redirect_uri);
      redirectUrl.searchParams.set('code', code);
      if (query.state) {
        redirectUrl.searchParams.set('state', query.state);
      }

      return res.redirect(redirectUrl.toString(), 302);
    } catch (err) {
      if (err instanceof OAuthError) {
        // Protocol-level failures that happen before we trust redirect_uri
        // (unknown client, mismatched redirect_uri) must not redirect --
        // that would itself be an open-redirect primitive. Report inline.
        return res.status(err.status).send({
          error: err.error,
          error_description: err.description,
        });
      }
      throw err;
    }
  }
}
