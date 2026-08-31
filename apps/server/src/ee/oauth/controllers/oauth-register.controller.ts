import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { Public } from '../../../common/decorators/public.decorator';
import { SkipTransform } from '../../../common/decorators/skip-transform.decorator';
import { RegisterClientDto } from '../dto/register-client.dto';
import { OAuthService } from '../services/oauth.service';
import { WorkspaceRepo } from '@f-doc/db/repos/workspace/workspace.repo';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { resolveOAuthWorkspace } from '../oauth-workspace.util';

/**
 * RFC 7591 Dynamic Client Registration. Public endpoint -- MCP clients
 * (e.g. Claude.ai) self-register before starting the authorization-code
 * flow, so no session/API-key auth is required here.
 */
@Controller('oauth')
export class OAuthRegisterController {
  constructor(
    private readonly oauthService: OAuthService,
    private readonly workspaceRepo: WorkspaceRepo,
    private readonly environmentService: EnvironmentService,
  ) {}

  @Public()
  @SkipTransform()
  @HttpCode(HttpStatus.OK)
  @Post('register')
  async register(
    @Body() dto: RegisterClientDto,
    @Req() req: FastifyRequest,
  ) {
    const workspace = await resolveOAuthWorkspace(
      req,
      this.workspaceRepo,
      this.environmentService,
    );
    if (!workspace) {
      throw new BadRequestException('Workspace not found');
    }

    return this.oauthService.registerClient(workspace.id, dto);
  }
}
