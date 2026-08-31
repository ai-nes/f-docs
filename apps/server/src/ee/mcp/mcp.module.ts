import { Module } from '@nestjs/common';
import { McpController } from './mcp.controller';
import { McpToolsService } from './services/mcp-tools.service';
import { PageModule } from '../../core/page/page.module';
import { SpaceModule } from '../../core/space/space.module';
import { CommentModule } from '../../core/comment/comment.module';
import { SearchModule } from '../../core/search/search.module';
import { AttachmentModule } from '../../core/attachment/attachment.module';

@Module({
  imports: [
    PageModule,
    SpaceModule,
    CommentModule,
    SearchModule,
    AttachmentModule,
  ],
  controllers: [McpController],
  providers: [McpToolsService],
})
export class McpModule {}
