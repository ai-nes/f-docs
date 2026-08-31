import { Module } from '@nestjs/common';
import { LicenceModule } from './licence/licence.module';
import { OAuthModule } from './oauth/oauth.module';
import { McpModule } from './mcp/mcp.module';

@Module({
  imports: [LicenceModule, OAuthModule, McpModule],
})
export class EeModule {}
