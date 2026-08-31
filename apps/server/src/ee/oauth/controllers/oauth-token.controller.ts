import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { Public } from '../../../common/decorators/public.decorator';
import { SkipTransform } from '../../../common/decorators/skip-transform.decorator';
import { TokenDto } from '../dto/token.dto';
import { OAuthError, OAuthService } from '../services/oauth.service';

/**
 * POST /oauth/token -- public endpoint. Public (PKCE-only, no client
 * secret) clients authenticate purely via the code_verifier / grant
 * ownership; confidential clients (token_endpoint_auth_method !=
 * 'none') would additionally need client_secret verification, which is
 * NOT implemented here -- see final report gaps section. Only
 * `none` (PKCE public client) auth was exercised end-to-end.
 */
@Controller('oauth')
export class OAuthTokenController {
  constructor(private readonly oauthService: OAuthService) {}

  @Public()
  @SkipTransform()
  @HttpCode(HttpStatus.OK)
  @Post('token')
  async token(@Body() dto: TokenDto, @Res({ passthrough: false }) res: FastifyReply) {
    try {
      if (dto.grant_type === 'authorization_code') {
        const result = await this.oauthService.exchangeAuthorizationCode({
          code: dto.code,
          redirectUri: dto.redirect_uri,
          clientId: dto.client_id,
          codeVerifier: dto.code_verifier,
        });
        return res.status(200).send(result);
      }

      if (dto.grant_type === 'refresh_token') {
        const result = await this.oauthService.refreshToken({
          refreshToken: dto.refresh_token,
          clientId: dto.client_id,
          scope: dto.scope,
        });
        return res.status(200).send(result);
      }

      return res.status(400).send({
        error: 'unsupported_grant_type',
        error_description: `grant_type '${dto.grant_type}' is not supported`,
      });
    } catch (err) {
      if (err instanceof OAuthError) {
        return res.status(err.status).send({
          error: err.error,
          error_description: err.description,
        });
      }
      throw err;
    }
  }
}
