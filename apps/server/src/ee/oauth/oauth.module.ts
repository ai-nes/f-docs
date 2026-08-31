import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { OAuthService } from './services/oauth.service';
import { OAuthStrategyService } from './services/oauth-strategy.service';
import { OAuthRegisterController } from './controllers/oauth-register.controller';
import { OAuthAuthorizeController } from './controllers/oauth-authorize.controller';
import { OAuthTokenController } from './controllers/oauth-token.controller';
import { WellKnownController } from './controllers/well-known.controller';

@Module({
  imports: [
    // `TokenModule`'s JwtModule registration is not exported/global, so we
    // register our own instance here configured identically (same secret,
    // same issuer) to `token.module.ts` / `auth.module.ts` so tokens this
    // module signs are accepted by `jwt.strategy.ts`'s passport-jwt
    // strategy, which verifies with `environmentService.getAppSecret()`.
    JwtModule.registerAsync({
      useFactory: async (environmentService: EnvironmentService) => ({
        secret: environmentService.getAppSecret(),
        signOptions: {
          expiresIn: environmentService.getJwtTokenExpiresIn() as StringValue,
        },
        // Note: unlike TokenModule, we do NOT set signOptions.issuer here.
        // OAuthService signs JwtOAuthPayload objects that already carry
        // their own `iss` field (the app URL, per JwtOAuthPayload's
        // shape); jsonwebtoken throws if both the payload and signOptions
        // specify "iss". jwt.strategy.ts's passport-jwt verification does
        // not check issuer, only secretOrKey, so this is safe.
      }),
      inject: [EnvironmentService],
    }),
  ],
  controllers: [
    OAuthRegisterController,
    OAuthAuthorizeController,
    OAuthTokenController,
    WellKnownController,
  ],
  providers: [OAuthService, OAuthStrategyService],
  exports: [OAuthService, OAuthStrategyService],
})
export class OAuthModule {}
