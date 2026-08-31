import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PageService } from '../../../core/page/services/page.service';
import { PageAccessService } from '../../../core/page/page-access/page-access.service';
import { PageRepo } from '@f-doc/db/repos/page/page.repo';
import { SpaceService } from '../../../core/space/services/space.service';
import { SpaceMemberService } from '../../../core/space/services/space-member.service';
import { CommentService } from '../../../core/comment/comment.service';
import { CommentRepo } from '@f-doc/db/repos/comment/comment.repo';
import { SearchService } from '../../../core/search/search.service';
import { WorkspaceRepo } from '@f-doc/db/repos/workspace/workspace.repo';
import SpaceAbilityFactory from '../../../core/casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../../../core/casl/interfaces/space-ability.type';
import { User, Workspace } from '@f-doc/db/types/entity.types';
import {
  jsonToHtml,
  jsonToMarkdown,
} from '../../../collaboration/collaboration.util';

export interface McpCallContext {
  user: User;
  workspace: Workspace;
  /** Present only when the caller authenticated via an OAuth access token. */
  oauthScopes?: string[];
}

/**
 * Thin MCP <-> REST translation layer. Every tool handler here calls the
 * exact same services and permission-check methods the REST controllers
 * use (PageController, SpaceController, CommentController,
 * SearchController) -- no business logic or authorization logic is
 * reimplemented. Read the corresponding *.controller.ts method body before
 * trusting a handler here to be correct; that's where the call sequence
 * this file replicates comes from.
 */
@Injectable()
export class McpToolsService {
  constructor(
    private readonly pageService: PageService,
    private readonly pageAccessService: PageAccessService,
    private readonly pageRepo: PageRepo,
    private readonly spaceService: SpaceService,
    private readonly spaceMemberService: SpaceMemberService,
    private readonly commentService: CommentService,
    private readonly commentRepo: CommentRepo,
    private readonly searchService: SearchService,
    private readonly workspaceRepo: WorkspaceRepo,
    private readonly spaceAbility: SpaceAbilityFactory,
  ) {}

  private renderContent(page: { content?: any }, format?: string) {
    if (!format || format === 'json' || !page.content) {
      return page.content;
    }
    return format === 'markdown'
      ? jsonToMarkdown(page.content)
      : jsonToHtml(page.content);
  }

  // ---- pages ---------------------------------------------------------

  async searchPages(ctx: McpCallContext, args: any) {
    const { query, spaceId, limit } = args ?? {};
    if (spaceId) {
      const ability = await this.spaceAbility.createForUser(ctx.user, spaceId);
      if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
        throw new ForbiddenException();
      }
    }

    return this.searchService.searchPage(
      { query, spaceId, limit: limit ?? 20 } as any,
      { userId: ctx.user.id, workspaceId: ctx.workspace.id },
    );
  }

  async getPage(ctx: McpCallContext, args: any) {
    const { pageId, format } = args ?? {};
    if (!pageId) throw new BadRequestException('pageId is required');

    const page = await this.pageRepo.findById(pageId, {
      includeSpace: true,
      includeContent: true,
      includeCreator: true,
      includeLastUpdatedBy: true,
      includeContributors: true,
    });
    if (!page) throw new NotFoundException('Page not found');

    const { canEdit, hasRestriction } =
      await this.pageAccessService.validateCanViewWithPermissions(
        page,
        ctx.user,
      );

    return {
      ...page,
      content: this.renderContent(page, format),
      permissions: { canEdit, hasRestriction },
    };
  }

  async createPage(ctx: McpCallContext, args: any) {
    const { spaceId, title, content, format, icon, parentPageId } = args ?? {};
    if (!spaceId) throw new BadRequestException('spaceId is required');

    if (parentPageId) {
      const parentPage = await this.pageRepo.findById(parentPageId);
      if (
        !parentPage ||
        parentPage.deletedAt ||
        parentPage.spaceId !== spaceId
      ) {
        throw new NotFoundException('Parent page not found');
      }
      await this.pageAccessService.validateCanEdit(parentPage, ctx.user);
    } else {
      const ability = await this.spaceAbility.createForUser(ctx.user, spaceId);
      if (ability.cannot(SpaceCaslAction.Create, SpaceCaslSubject.Page)) {
        throw new ForbiddenException();
      }
    }

    const page = await this.pageService.create(ctx.user.id, ctx.workspace.id, {
      spaceId,
      title,
      content,
      format: format ?? (content ? 'markdown' : undefined),
      icon,
      parentPageId,
    } as any);

    const { canEdit, hasRestriction } =
      await this.pageAccessService.validateCanViewWithPermissions(
        page,
        ctx.user,
      );

    return {
      ...page,
      content: this.renderContent(page, format),
      permissions: { canEdit, hasRestriction },
    };
  }

  async updatePage(ctx: McpCallContext, args: any) {
    const { pageId, title, content, format, operation, icon } = args ?? {};
    if (!pageId) throw new BadRequestException('pageId is required');

    const page = await this.pageRepo.findById(pageId);
    if (!page) throw new NotFoundException('Page not found');

    const { hasRestriction } = await this.pageAccessService.validateCanEdit(
      page,
      ctx.user,
    );

    const updatedPage = await this.pageService.update(
      page,
      {
        pageId,
        title,
        content,
        format: format ?? (content ? 'markdown' : undefined),
        operation: operation ?? (content ? 'replace' : undefined),
        icon,
      } as any,
      ctx.user,
    );

    return {
      ...updatedPage,
      content: this.renderContent(updatedPage, format),
      permissions: { canEdit: true, hasRestriction },
    };
  }

  async listPages(ctx: McpCallContext, args: any) {
    const { spaceId, limit, cursor } = args ?? {};
    const pagination = { limit: limit ?? 20, cursor } as any;

    if (spaceId) {
      const ability = await this.spaceAbility.createForUser(ctx.user, spaceId);
      if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
        throw new ForbiddenException();
      }
      return this.pageService.getRecentSpacePages(
        spaceId,
        ctx.user.id,
        pagination,
      );
    }

    return this.pageService.getRecentPages(ctx.user.id, pagination);
  }

  async listChildPages(ctx: McpCallContext, args: any) {
    const { pageId, spaceId, limit, cursor } = args ?? {};
    if (!pageId && !spaceId) {
      throw new BadRequestException('Either pageId or spaceId must be provided');
    }

    let resolvedSpaceId = spaceId;
    if (pageId) {
      const page = await this.pageRepo.findById(pageId);
      if (!page) throw new ForbiddenException();
      resolvedSpaceId = page.spaceId;
    }

    const ability = await this.spaceAbility.createForUser(
      ctx.user,
      resolvedSpaceId,
    );
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }
    const spaceCanEdit = ability.can(SpaceCaslAction.Edit, SpaceCaslSubject.Page);

    return this.pageService.getSidebarPages(
      resolvedSpaceId,
      { limit: limit ?? 50, cursor } as any,
      pageId,
      ctx.user.id,
      spaceCanEdit,
    );
  }

  async movePage(ctx: McpCallContext, args: any) {
    const { pageId, parentPageId, position } = args ?? {};
    if (!pageId) throw new BadRequestException('pageId is required');

    const movedPage = await this.pageRepo.findById(pageId);
    if (!movedPage) throw new NotFoundException('Moved page not found');

    const ability = await this.spaceAbility.createForUser(
      ctx.user,
      movedPage.spaceId,
    );
    if (ability.cannot(SpaceCaslAction.Edit, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    await this.pageAccessService.validateCanEdit(movedPage, ctx.user);

    if (parentPageId && parentPageId !== movedPage.parentPageId) {
      const targetParent = await this.pageRepo.findById(parentPageId);
      if (!targetParent || targetParent.deletedAt) {
        throw new NotFoundException('Target parent page not found');
      }
      await this.pageAccessService.validateCanEdit(targetParent, ctx.user);
    }

    return this.pageService.movePage(
      { pageId, parentPageId, position } as any,
      movedPage,
    );
  }

  async movePageToSpace(ctx: McpCallContext, args: any) {
    const { pageId, spaceId } = args ?? {};
    if (!pageId || !spaceId) {
      throw new BadRequestException('pageId and spaceId are required');
    }

    const movedPage = await this.pageRepo.findById(pageId);
    if (!movedPage) throw new NotFoundException('Page to move not found');
    if (movedPage.spaceId === spaceId) {
      throw new BadRequestException('Page is already in this space');
    }

    const abilities = await Promise.all([
      this.spaceAbility.createForUser(ctx.user, movedPage.spaceId),
      this.spaceAbility.createForUser(ctx.user, spaceId),
    ]);
    if (
      abilities.some((a) => a.cannot(SpaceCaslAction.Edit, SpaceCaslSubject.Page))
    ) {
      throw new ForbiddenException();
    }

    await this.pageAccessService.validateCanEdit(movedPage, ctx.user);

    const { childPageIds } = await this.pageService.movePageToSpace(
      movedPage,
      spaceId,
      ctx.user.id,
    );
    return { pageId, spaceId, childPageIds };
  }

  async duplicatePage(ctx: McpCallContext, args: any) {
    const { pageId, spaceId } = args ?? {};
    if (!pageId) throw new BadRequestException('pageId is required');

    const copiedPage = await this.pageRepo.findById(pageId);
    if (!copiedPage) throw new NotFoundException('Page to copy not found');

    await this.pageAccessService.validateCanView(copiedPage, ctx.user);

    if (spaceId) {
      const abilities = await Promise.all([
        this.spaceAbility.createForUser(ctx.user, copiedPage.spaceId),
        this.spaceAbility.createForUser(ctx.user, spaceId),
      ]);
      if (
        abilities.some((a) =>
          a.cannot(SpaceCaslAction.Edit, SpaceCaslSubject.Page),
        )
      ) {
        throw new ForbiddenException();
      }
      return this.pageService.duplicatePage(copiedPage, spaceId, ctx.user);
    }

    const ability = await this.spaceAbility.createForUser(
      ctx.user,
      copiedPage.spaceId,
    );
    if (ability.cannot(SpaceCaslAction.Edit, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }
    return this.pageService.duplicatePage(copiedPage, undefined, ctx.user);
  }

  // ---- spaces ---------------------------------------------------------

  async listSpaces(ctx: McpCallContext, args: any) {
    const { limit, cursor } = args ?? {};
    return this.spaceMemberService.getUserSpaces(ctx.user.id, {
      limit: limit ?? 20,
      cursor,
    } as any);
  }

  async getSpace(ctx: McpCallContext, args: any) {
    const { spaceId } = args ?? {};
    if (!spaceId) throw new BadRequestException('spaceId is required');

    const space = await this.spaceService.getSpaceInfo(
      spaceId,
      ctx.workspace.id,
    );
    if (!space) throw new NotFoundException('Space not found');

    const ability = await this.spaceAbility.createForUser(ctx.user, space.id);
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }

    return space;
  }

  async createSpace(ctx: McpCallContext, args: any) {
    const { name, description, slug } = args ?? {};
    if (!name || !slug) {
      throw new BadRequestException('name and slug are required');
    }
    return this.spaceService.createSpace(ctx.user, ctx.workspace.id, {
      name,
      description,
      slug,
    } as any);
  }

  async updateSpace(ctx: McpCallContext, args: any) {
    const { spaceId, name, description, slug } = args ?? {};
    if (!spaceId) throw new BadRequestException('spaceId is required');

    const ability = await this.spaceAbility.createForUser(ctx.user, spaceId);
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }
    return this.spaceService.updateSpace(
      { spaceId, name, description, slug } as any,
      ctx.workspace.id,
    );
  }

  // ---- comments ---------------------------------------------------------

  async getComments(ctx: McpCallContext, args: any) {
    const { pageId, limit, cursor } = args ?? {};
    if (!pageId) throw new BadRequestException('pageId is required');

    const page = await this.pageRepo.findById(pageId);
    if (!page || page.workspaceId !== ctx.workspace.id || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }
    await this.pageAccessService.validateCanView(page, ctx.user);

    return this.commentService.findByPageId(page.id, {
      limit: limit ?? 20,
      cursor,
    } as any);
  }

  async createComment(ctx: McpCallContext, args: any) {
    const { pageId, content, parentCommentId, selection } = args ?? {};
    if (!pageId || !content) {
      throw new BadRequestException('pageId and content are required');
    }

    const page = await this.pageRepo.findById(pageId);
    if (!page || page.workspaceId !== ctx.workspace.id || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }
    await this.pageAccessService.validateCanComment(
      page,
      ctx.user,
      ctx.workspace.id,
    );

    return this.commentService.create(
      { page, workspaceId: ctx.workspace.id, user: ctx.user },
      {
        pageId,
        content: typeof content === 'string' ? content : JSON.stringify(content),
        parentCommentId,
        selection,
      } as any,
    );
  }

  async updateComment(ctx: McpCallContext, args: any) {
    const { commentId, content } = args ?? {};
    if (!commentId || !content) {
      throw new BadRequestException('commentId and content are required');
    }

    const comment = await this.commentRepo.findById(commentId, {
      includeCreator: true,
      includeResolvedBy: true,
    });
    if (!comment) throw new NotFoundException('Comment not found');

    const page = await this.pageRepo.findById(comment.pageId);
    if (!page || page.workspaceId !== ctx.workspace.id || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }
    await this.pageAccessService.validateCanComment(
      page,
      ctx.user,
      ctx.workspace.id,
    );

    return this.commentService.update(
      comment,
      {
        commentId,
        content: typeof content === 'string' ? content : JSON.stringify(content),
      } as any,
      ctx.user,
    );
  }

  // ---- misc ---------------------------------------------------------

  async getCurrentUser(ctx: McpCallContext) {
    const memberCount = await this.workspaceRepo.getActiveUserCount(
      ctx.workspace.id,
    );
    const { licenseKey, ...rest } = ctx.workspace as any;
    return {
      user: ctx.user,
      workspace: { ...rest, memberCount },
    };
  }
}
