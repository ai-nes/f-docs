import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OAuthScope } from '../../common/decorators/oauth-scope.decorator';
import { SkipTransform } from '../../common/decorators/skip-transform.decorator';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@f-doc/db/types/entity.types';
import { McpToolsService } from './services/mcp-tools.service';
import { MCP_TOOLS } from './mcp-tools.definitions';

const PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26'];

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: any;
}

/**
 * MCP Streamable HTTP transport: a single POST endpoint multiplexing
 * JSON-RPC 2.0 requests. Implemented directly against the wire protocol
 * (no SDK) -- see method-by-method comments below for the framing rules
 * this follows.
 *
 * Auth: any bearer token JwtAuthGuard accepts (interactive session, API
 * key, or OAuth access token) can reach this route -- @OAuthScope('read')
 * is the HTTP-route-level floor. Because a single POST carries many
 * logical JSON-RPC operations of different sensitivity, the *additional*
 * write-scope check for mutating tools happens per-call inside the
 * dispatcher (see `assertWriteAllowed`), not at the guard/route level.
 */
@UseGuards(JwtAuthGuard)
@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);
  private readonly toolNames = new Set(MCP_TOOLS.map((t) => t.name));
  private readonly mutatingTools = new Set(
    MCP_TOOLS.filter((t) => t.mutating).map((t) => t.name),
  );

  constructor(private readonly mcpTools: McpToolsService) {}

  @OAuthScope('read')
  @SkipTransform()
  @HttpCode(HttpStatus.OK)
  @Post()
  async handle(
    @Body() body: JsonRpcRequest | JsonRpcRequest[],
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Req() req: FastifyRequest,
    @Res({ passthrough: false }) res: FastifyReply,
  ) {
    const oauthScopes = ((req as any).user)?.oauth?.scopes as
      | string[]
      | undefined;

    if (Array.isArray(body)) {
      const responses = [];
      for (const message of body) {
        const response = await this.dispatch(message, user, workspace, oauthScopes);
        if (response !== undefined) responses.push(response);
      }
      if (responses.length === 0) {
        return res.status(202).send();
      }
      return res.status(200).send(responses);
    }

    const response = await this.dispatch(body, user, workspace, oauthScopes);
    if (response === undefined) {
      // Notification (no `id`) -- Streamable HTTP acks with an empty 202.
      return res.status(202).send();
    }
    return res.status(200).send(response);
  }

  private async dispatch(
    message: JsonRpcRequest,
    user: User,
    workspace: Workspace,
    oauthScopes: string[] | undefined,
  ): Promise<any | undefined> {
    const { id, method, params } = message ?? ({} as JsonRpcRequest);
    const hasId = id !== undefined && id !== null;

    try {
      switch (method) {
        case 'initialize':
          return this.reply(id, hasId, {
            protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(
              params?.protocolVersion,
            )
              ? params.protocolVersion
              : PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'f-doc', version: '1.0.0' },
          });

        case 'notifications/initialized':
        case 'notifications/cancelled':
          // Notifications carry no `id` and get no JSON-RPC response body.
          return undefined;

        case 'ping':
          return this.reply(id, hasId, {});

        case 'tools/list':
          return this.reply(id, hasId, {
            tools: MCP_TOOLS.map(({ mutating: _mutating, ...tool }) => tool),
          });

        case 'tools/call':
          return this.reply(
            id,
            hasId,
            await this.callTool(params, user, workspace, oauthScopes),
          );

        default:
          return this.error(id, hasId, -32601, 'Method not found');
      }
    } catch (err: any) {
      this.logger.error(
        `MCP dispatch failed for method=${method}: ${err?.message}`,
        err?.stack,
      );
      return this.error(id, hasId, -32000, err?.message ?? 'Internal error');
    }
  }

  private async callTool(
    params: any,
    user: User,
    workspace: Workspace,
    oauthScopes: string[] | undefined,
  ) {
    const toolName = params?.name;
    const args = params?.arguments ?? {};

    if (!toolName || !this.toolNames.has(toolName)) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
    }

    if (oauthScopes && this.mutatingTools.has(toolName)) {
      if (!oauthScopes.includes('write')) {
        return {
          content: [
            {
              type: 'text',
              text: `insufficient_scope: tool '${toolName}' requires the 'write' OAuth scope`,
            },
          ],
          isError: true,
        };
      }
    }

    const ctx = { user, workspace, oauthScopes };

    try {
      const result = await this.invokeTool(toolName, ctx, args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (err: any) {
      // Business-logic failures (NotFound/Forbidden/BadRequest) become MCP
      // tool errors, not JSON-RPC protocol errors or HTTP 500s -- MCP
      // clients expect isError:true here, not a broken HTTP call.
      return {
        content: [{ type: 'text', text: err?.message ?? 'Tool call failed' }],
        isError: true,
      };
    }
  }

  private invokeTool(name: string, ctx: any, args: any) {
    switch (name) {
      case 'search_pages':
        return this.mcpTools.searchPages(ctx, args);
      case 'get_page':
        return this.mcpTools.getPage(ctx, args);
      case 'create_page':
        return this.mcpTools.createPage(ctx, args);
      case 'update_page':
        return this.mcpTools.updatePage(ctx, args);
      case 'list_pages':
        return this.mcpTools.listPages(ctx, args);
      case 'list_child_pages':
        return this.mcpTools.listChildPages(ctx, args);
      case 'duplicate_page':
        return this.mcpTools.duplicatePage(ctx, args);
      case 'move_page':
        return this.mcpTools.movePage(ctx, args);
      case 'move_page_to_space':
        return this.mcpTools.movePageToSpace(ctx, args);
      case 'get_space':
        return this.mcpTools.getSpace(ctx, args);
      case 'list_spaces':
        return this.mcpTools.listSpaces(ctx, args);
      case 'create_space':
        return this.mcpTools.createSpace(ctx, args);
      case 'update_space':
        return this.mcpTools.updateSpace(ctx, args);
      case 'get_comments':
        return this.mcpTools.getComments(ctx, args);
      case 'create_comment':
        return this.mcpTools.createComment(ctx, args);
      case 'update_comment':
        return this.mcpTools.updateComment(ctx, args);
      case 'get_current_user':
        return this.mcpTools.getCurrentUser(ctx);
      case 'upload_attachment':
        return this.mcpTools.uploadAttachment(ctx, args);
      default:
        throw new Error(`Unhandled tool: ${name}`);
    }
  }

  private reply(id: any, hasId: boolean, result: any) {
    if (!hasId) return undefined;
    return { jsonrpc: '2.0', id, result };
  }

  private error(id: any, hasId: boolean, code: number, message: string) {
    if (!hasId) return undefined;
    return { jsonrpc: '2.0', id, error: { code, message } };
  }
}
