import { WorkspaceRepo } from '@f-doc/db/repos/workspace/workspace.repo';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { Workspace } from '@f-doc/db/types/entity.types';
import { FastifyRequest } from 'fastify';

/**
 * Resolves the workspace for public/semi-public OAuth endpoints
 * (registration, discovery, authorize, token) that sit outside the global
 * `/api` prefix or are hit before DomainMiddleware would normally attach
 * `req.raw.workspace`. Mirrors the resolution strategy already used by
 * `ShareSeoController` (apps/server/src/core/share/share-seo.controller.ts):
 * self-hosted deployments have exactly one workspace, cloud deployments
 * resolve it from the request's subdomain.
 */
export async function resolveOAuthWorkspace(
  req: FastifyRequest,
  workspaceRepo: WorkspaceRepo,
  environmentService: EnvironmentService,
): Promise<Workspace | null> {
  const existing = (req.raw as any)?.workspace as Workspace | undefined;
  if (existing) {
    return existing;
  }

  if (environmentService.isSelfHosted()) {
    return workspaceRepo.findFirst();
  }

  const host = req.headers.host;
  const subdomain = host?.split('.')[0];
  if (!subdomain) {
    return null;
  }
  return workspaceRepo.findByHostname(subdomain);
}
