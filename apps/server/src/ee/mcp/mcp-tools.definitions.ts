/**
 * MCP `tools/list` definitions. Every tool's inputSchema mirrors the DTO
 * fields the underlying service call actually consumes -- see
 * McpToolsService (apps/server/src/ee/mcp/services/mcp-tools.service.ts)
 * for the handler each of these dispatches to, and the corresponding
 * *.controller.ts under apps/server/src/core for the REST route it mirrors.
 *
 * `mutating` tools are gated behind the OAuth `write` scope inside the
 * JSON-RPC dispatcher (McpController) -- session/API-key callers are
 * unaffected, since scope enforcement only applies when req.user.oauth is
 * present.
 */
export interface McpToolDefinition {
  name: string;
  description: string;
  mutating: boolean;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'search_pages',
    description: 'Full-text search for pages in the workspace, optionally scoped to a space.',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query text' },
        spaceId: { type: 'string', description: 'Restrict search to this space (UUID)' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_page',
    description: 'Get a page by id or slugId, including its content.',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: 'Page id or slugId' },
        format: { type: 'string', enum: ['json', 'markdown', 'html'], description: 'Content output format (default json)' },
      },
      required: ['pageId'],
    },
  },
  {
    name: 'create_page',
    description: 'Create a new page in a space, optionally as a child of another page.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        spaceId: { type: 'string', description: 'Space id (UUID) to create the page in' },
        title: { type: 'string' },
        content: { type: 'string', description: 'Page content, in the format given by `format`' },
        format: { type: 'string', enum: ['json', 'markdown', 'html'], description: 'Format of `content` (default markdown when content is set)' },
        icon: { type: 'string' },
        parentPageId: { type: 'string', description: 'Optional parent page id to nest under' },
      },
      required: ['spaceId'],
    },
  },
  {
    name: 'update_page',
    description: 'Update a page\'s title, icon, and/or content.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        title: { type: 'string' },
        icon: { type: 'string' },
        content: { type: 'string' },
        format: { type: 'string', enum: ['json', 'markdown', 'html'], description: 'Format of `content` (default markdown when content is set)' },
        operation: { type: 'string', enum: ['append', 'prepend', 'replace'], description: 'How to apply `content` (default replace when content is set)' },
      },
      required: ['pageId'],
    },
  },
  {
    name: 'list_pages',
    description: 'List recently updated pages across the workspace, or within a single space.',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: {
        spaceId: { type: 'string', description: 'Restrict to this space (UUID)' },
        limit: { type: 'number' },
        cursor: { type: 'string' },
      },
    },
  },
  {
    name: 'list_child_pages',
    description: 'List the direct child pages of a page, or the root pages of a space.',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: 'Parent page id; omit for space root pages' },
        spaceId: { type: 'string', description: 'Required when pageId is omitted' },
        limit: { type: 'number' },
        cursor: { type: 'string' },
      },
    },
  },
  {
    name: 'duplicate_page',
    description: 'Duplicate a page (and its accessible descendants), optionally into a different space.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        spaceId: { type: 'string', description: 'Target space id; omit to duplicate in the same space' },
      },
      required: ['pageId'],
    },
  },
  {
    name: 'move_page',
    description: 'Move a page to a new parent (or to root) within its current space.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        parentPageId: { type: 'string', description: 'New parent page id; omit to move to root' },
        position: { type: 'string' },
      },
      required: ['pageId'],
    },
  },
  {
    name: 'move_page_to_space',
    description: 'Move a page (and accessible child pages) to a different space.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        spaceId: { type: 'string', description: 'Destination space id' },
      },
      required: ['pageId', 'spaceId'],
    },
  },
  {
    name: 'get_space',
    description: 'Get details of a space by id.',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: { spaceId: { type: 'string' } },
      required: ['spaceId'],
    },
  },
  {
    name: 'list_spaces',
    description: 'List spaces the current user is a member of.',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
        cursor: { type: 'string' },
      },
    },
  },
  {
    name: 'create_space',
    description: 'Create a new space in the workspace.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        slug: { type: 'string' },
      },
      required: ['name', 'slug'],
    },
  },
  {
    name: 'update_space',
    description: 'Update a space\'s name, description, or slug.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        spaceId: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        slug: { type: 'string' },
      },
      required: ['spaceId'],
    },
  },
  {
    name: 'get_comments',
    description: 'List comments on a page.',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        limit: { type: 'number' },
        cursor: { type: 'string' },
      },
      required: ['pageId'],
    },
  },
  {
    name: 'create_comment',
    description: 'Create a comment (or reply) on a page.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        content: { type: 'string', description: 'Comment content as a JSON-stringified ProseMirror document, or plain text' },
        parentCommentId: { type: 'string', description: 'Reply to this comment id' },
        selection: { type: 'string' },
      },
      required: ['pageId', 'content'],
    },
  },
  {
    name: 'update_comment',
    description: 'Update the content of a comment you authored.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        commentId: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['commentId', 'content'],
    },
  },
  {
    name: 'get_current_user',
    description: 'Get the authenticated user and their current workspace.',
    mutating: false,
    inputSchema: { type: 'object', properties: {} },
  },

  // ---- attachments ---------------------------------------------------

  {
    name: 'upload_attachment',
    description:
      'Upload a file (e.g. an SVG chart) as a real F-Doc attachment on a page, from base64-encoded content. Returns the attachment record plus its accessible URL -- embed that URL in page content via markdown image syntax (![alt](url)) to display it.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: 'Page id (or slugId) the file is attached to' },
        fileName: { type: 'string', description: 'File name including extension, e.g. "chart.svg"' },
        mimeType: { type: 'string', description: 'Optional MIME type hint; the server derives the actual type from the file extension' },
        contentBase64: { type: 'string', description: 'File content, base64-encoded' },
        attachmentId: { type: 'string', description: 'Existing attachment id to overwrite in place, instead of creating a new attachment' },
      },
      required: ['pageId', 'fileName', 'contentBase64'],
    },
  },
];
