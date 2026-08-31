import { Module } from '@nestjs/common';
import { McpController } from './mcp.controller';
import { McpToolsService } from './services/mcp-tools.service';
import { PageModule } from '../../core/page/page.module';
import { SpaceModule } from '../../core/space/space.module';
import { CommentModule } from '../../core/comment/comment.module';
import { SearchModule } from '../../core/search/search.module';

@Module({
  imports: [PageModule, SpaceModule, CommentModule, SearchModule],
  controllers: [McpController],
  providers: [McpToolsService],
})
export class McpModule {}
