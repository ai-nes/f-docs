import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { SkipTransform } from '../../../common/decorators/skip-transform.decorator';
import { EnvironmentService } from '../../../integrations/environment/environment.service';

/**
 * RFC 8414 (OAuth Authorization Server Metadata) and RFC 9728 (OAuth
 * Protected Resource Metadata) discovery documents. Registered outside the
 * global `/api` prefix -- see main.ts's setGlobalPrefix exclude list, which
 * already carries the exact paths this controller serves.
 */
@Controller('.well-known')
export class WellKnownController {
  constructor(private readonly environmentService: EnvironmentService) {}

  @Public()
  @SkipTransform()
  @HttpCode(HttpStatus.OK)
  @Get('oauth-authorization-server')
  authorizationServerMetadata() {
    const appUrl = this.environmentService.getAppUrl();
    return {
      issuer: appUrl,
      authorization_endpoint: `${appUrl}/api/oauth/authorize`,
      token_endpoint: `${appUrl}/api/oauth/token`,
      registration_endpoint: `${appUrl}/api/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
      scopes_supported: ['read', 'write'],
    };
  }

  @Public()
  @SkipTransform()
  @HttpCode(HttpStatus.OK)
  @Get('oauth-protected-resource')
  protectedResourceMetadata() {
    return this.buildProtectedResourceMetadata();
  }

  @Public()
  @SkipTransform()
  @HttpCode(HttpStatus.OK)
  @Get('oauth-protected-resource/mcp')
  protectedResourceMetadataForMcp() {
    return this.buildProtectedResourceMetadata();
  }

  private buildProtectedResourceMetadata() {
    const appUrl = this.environmentService.getAppUrl();
    return {
      resource: `${appUrl}/mcp`,
      authorization_servers: [appUrl],
      scopes_supported: ['read', 'write'],
      bearer_methods_supported: ['header'],
    };
  }
}
