import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { addDays, addMinutes } from 'date-fns';
import { OAuthClientRepo } from '../../../database/repos/oauth/oauth-client.repo';
import { OAuthAuthorizationCodeRepo } from '../../../database/repos/oauth/oauth-authorization-code.repo';
import { OAuthGrantRepo } from '../../../database/repos/oauth/oauth-grant.repo';
import { OAuthTokenRepo } from '../../../database/repos/oauth/oauth-token.repo';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { JwtOAuthPayload, JwtType } from '../../../core/auth/dto/jwt-payload';
import {
  OAuthAuthorizationCode,
  OAuthClient,
} from '@f-doc/db/types/entity.types';

export const DEFAULT_SCOPES = ['read', 'write'];
const AUTHORIZATION_CODE_TTL_MINUTES = 10;
const ACCESS_TOKEN_TTL = '1h';
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_DAYS = 30;

export class OAuthError extends Error {
  constructor(
    public readonly error: string,
    public readonly description: string,
    public readonly status: number = 400,
  ) {
    super(description);
  }
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function base64UrlSha256(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

@Injectable()
export class OAuthService {
  constructor(
    private readonly oauthClientRepo: OAuthClientRepo,
    private readonly oauthAuthorizationCodeRepo: OAuthAuthorizationCodeRepo,
    private readonly oauthGrantRepo: OAuthGrantRepo,
    private readonly oauthTokenRepo: OAuthTokenRepo,
    private readonly jwtService: JwtService,
    private readonly environmentService: EnvironmentService,
  ) {}

  async registerClient(
    workspaceId: string,
    dto: {
      redirect_uris: string[];
      client_name?: string;
      client_uri?: string;
      logo_uri?: string;
      grant_types?: string[];
      token_endpoint_auth_method?: string;
      scope?: string;
    },
  ) {
    const tokenEndpointAuthMethod = dto.token_endpoint_auth_method ?? 'none';
    const grantTypes = dto.grant_types?.length
      ? dto.grant_types
      : ['authorization_code', 'refresh_token'];
    const scopes = dto.scope ? dto.scope.split(' ').filter(Boolean) : DEFAULT_SCOPES;

    let rawSecret: string | undefined;
    let secretHash: string | undefined;
    if (tokenEndpointAuthMethod !== 'none') {
      rawSecret = randomBytes(32).toString('base64url');
      secretHash = sha256Hex(rawSecret);
    }

    const client = await this.oauthClientRepo.insertClient({
      name: dto.client_name ?? 'MCP Client',
      redirectUris: dto.redirect_uris,
      clientUri: dto.client_uri ?? null,
      logoUri: dto.logo_uri ?? null,
      grantTypes,
      scopes,
      tokenEndpointAuthMethod,
      secretHash: secretHash ?? null,
      isDynamic: true,
      workspaceId,
    });

    return {
      client_id: client.id,
      client_name: client.name,
      client_uri: client.clientUri ?? undefined,
      logo_uri: client.logoUri ?? undefined,
      redirect_uris: client.redirectUris,
      grant_types: client.grantTypes,
      token_endpoint_auth_method: client.tokenEndpointAuthMethod,
      scope: scopes.join(' '),
      client_id_issued_at: Math.floor(
        new Date(client.createdAt).getTime() / 1000,
      ),
      ...(rawSecret ? { client_secret: rawSecret } : {}),
    };
  }

  /**
   * Validates an /oauth/authorize request and issues a single-use
   * authorization code. Returns the raw code (never stored) for the caller
   * to redirect back to the client with.
   *
   * NOTE: this is an auto-approve flow. There is no consent screen -- any
   * authenticated interactive session that hits this endpoint with a valid
   * client_id/redirect_uri immediately gets an authorization code for that
   * client. A production-grade implementation should render a consent
   * screen (client name + requested scopes) and require explicit user
   * approval before issuing the code.
   */
  async authorize(opts: {
    workspaceId: string;
    userId: string;
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    scope?: string;
  }): Promise<{ code: string; client: OAuthClient }> {
    const client = await this.oauthClientRepo.findByIdAndWorkspace(
      opts.clientId,
      opts.workspaceId,
    );
    if (!client) {
      throw new OAuthError('invalid_client', 'Unknown client_id', 400);
    }

    const registeredRedirectUris = (client.redirectUris ?? []) as string[];
    if (!registeredRedirectUris.includes(opts.redirectUri)) {
      throw new OAuthError(
        'invalid_request',
        'redirect_uri does not match a registered redirect URI',
        400,
      );
    }

    if (opts.codeChallengeMethod !== 'S256') {
      throw new OAuthError(
        'invalid_request',
        'Only the S256 code_challenge_method is supported',
        400,
      );
    }

    const clientScopes = (client.scopes ?? []) as string[];
    const requestedScopes = opts.scope
      ? opts.scope.split(' ').filter(Boolean)
      : clientScopes;
    const scopes = requestedScopes.filter((s) => clientScopes.includes(s));
    if (scopes.length === 0) {
      throw new OAuthError(
        'invalid_scope',
        'None of the requested scopes are permitted for this client',
        400,
      );
    }

    const rawCode = randomBytes(32).toString('base64url');
    const codeHash = sha256Hex(rawCode);

    await this.oauthAuthorizationCodeRepo.insertCode({
      codeHash,
      clientId: client.id,
      userId: opts.userId,
      workspaceId: opts.workspaceId,
      scopes,
      redirectUri: opts.redirectUri,
      codeChallenge: opts.codeChallenge,
      codeChallengeMethod: opts.codeChallengeMethod,
      expiresAt: addMinutes(new Date(), AUTHORIZATION_CODE_TTL_MINUTES),
    });

    return { code: rawCode, client };
  }

  async exchangeAuthorizationCode(opts: {
    code: string;
    redirectUri: string;
    clientId: string;
    codeVerifier: string;
  }) {
    if (!opts.code || !opts.redirectUri || !opts.clientId || !opts.codeVerifier) {
      throw new OAuthError(
        'invalid_request',
        'code, redirect_uri, client_id and code_verifier are required',
      );
    }

    const codeHash = sha256Hex(opts.code);
    const authCode = await this.oauthAuthorizationCodeRepo.findValidByHash(
      codeHash,
    );
    if (!authCode) {
      throw new OAuthError(
        'invalid_grant',
        'Authorization code is invalid, expired, or already used',
      );
    }

    if (authCode.clientId !== opts.clientId) {
      throw new OAuthError('invalid_grant', 'client_id does not match');
    }

    if (authCode.redirectUri !== opts.redirectUri) {
      throw new OAuthError('invalid_grant', 'redirect_uri does not match');
    }

    this.verifyPkce(authCode, opts.codeVerifier);

    // Single-use: mark consumed before doing anything else observable.
    await this.oauthAuthorizationCodeRepo.markConsumed(authCode.id);

    const scopes = (authCode.scopes ?? []) as string[];

    const grant = await this.oauthGrantRepo.findOrCreateGrant({
      userId: authCode.userId,
      clientId: authCode.clientId,
      workspaceId: authCode.workspaceId,
      scopes,
    });

    return this.issueTokenPair({
      userId: authCode.userId,
      workspaceId: authCode.workspaceId,
      clientId: authCode.clientId,
      grantId: grant.id,
      scopes,
    });
  }

  async refreshToken(opts: {
    refreshToken: string;
    clientId: string;
    scope?: string;
  }) {
    if (!opts.refreshToken || !opts.clientId) {
      throw new OAuthError(
        'invalid_request',
        'refresh_token and client_id are required',
      );
    }

    const refreshTokenHash = sha256Hex(opts.refreshToken);
    const existingToken =
      await this.oauthTokenRepo.findValidByRefreshTokenHash(refreshTokenHash);
    if (!existingToken) {
      throw new OAuthError(
        'invalid_grant',
        'Refresh token is invalid, expired, or revoked',
      );
    }

    const grant = await this.oauthGrantRepo.findById(existingToken.grantId);
    if (!grant || grant.revokedAt) {
      throw new OAuthError('invalid_grant', 'Grant revoked or not found');
    }

    if (grant.clientId !== opts.clientId) {
      throw new OAuthError('invalid_client', 'client_id does not match grant');
    }

    const grantScopes = (grant.scopes ?? []) as string[];
    const scopes = opts.scope
      ? opts.scope.split(' ').filter((s) => grantScopes.includes(s))
      : grantScopes;
    if (scopes.length === 0) {
      throw new OAuthError('invalid_scope', 'Requested scope not granted');
    }

    // Rotation: revoke the old token row before issuing the replacement so
    // the old refresh token can never be replayed.
    await this.oauthTokenRepo.revoke(existingToken.id);
    await this.oauthGrantRepo.touchLastUsed(grant.id);

    return this.issueTokenPair({
      userId: grant.userId,
      workspaceId: grant.workspaceId,
      clientId: grant.clientId,
      grantId: grant.id,
      scopes,
    });
  }

  private verifyPkce(
    authCode: OAuthAuthorizationCode,
    codeVerifier: string,
  ): void {
    if (!authCode.codeChallenge || !authCode.codeChallengeMethod) {
      throw new OAuthError(
        'invalid_grant',
        'Authorization code was not issued with PKCE',
      );
    }

    if (authCode.codeChallengeMethod !== 'S256') {
      throw new OAuthError(
        'invalid_grant',
        'Unsupported code_challenge_method',
      );
    }

    const computedChallenge = base64UrlSha256(codeVerifier);
    if (computedChallenge !== authCode.codeChallenge) {
      throw new OAuthError('invalid_grant', 'PKCE verification failed');
    }
  }

  private async issueTokenPair(opts: {
    userId: string;
    workspaceId: string;
    clientId: string;
    grantId: string;
    scopes: string[];
  }) {
    const jti = randomUUID();
    const scope = opts.scopes.join(' ');

    const payload: JwtOAuthPayload = {
      sub: opts.userId,
      workspaceId: opts.workspaceId,
      grantId: opts.grantId,
      scope,
      aud: opts.clientId,
      iss: this.environmentService.getAppUrl(),
      jti,
      type: JwtType.OAUTH_ACCESS,
    };

    const accessToken = await this.jwtService.signAsync(payload, {
      expiresIn: ACCESS_TOKEN_TTL,
    });

    const rawRefreshToken = randomBytes(32).toString('base64url');
    const refreshTokenHash = sha256Hex(rawRefreshToken);

    await this.oauthTokenRepo.insertToken({
      grantId: opts.grantId,
      workspaceId: opts.workspaceId,
      accessTokenJti: jti,
      refreshTokenHash,
      scopes: opts.scopes,
      accessExpiresAt: addMinutes(new Date(), 60),
      refreshExpiresAt: addDays(new Date(), REFRESH_TOKEN_TTL_DAYS),
    });

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: rawRefreshToken,
      scope,
    };
  }
}
