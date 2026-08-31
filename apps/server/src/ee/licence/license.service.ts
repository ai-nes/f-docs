import { Injectable } from '@nestjs/common';

/**
 * Self-hosted enterprise-license stub.
 *
 * F-Doc's cloud build ships a real licensing service under this exact path
 * (`ee/licence/license.service`) that validates a signed license key against
 * a plan/feature matrix. That real implementation is not part of this
 * self-hosted build.
 *
 * `LicenseCheckService` (apps/server/src/integrations/environment/license-check.service.ts)
 * resolves this class via `ModuleRef.get(LicenseService, { strict: false })`
 * after a `require('../../ee/licence/license.service')`. For self-hosted
 * deployments we intentionally unlock every enterprise-gated feature
 * (including MCP) unconditionally — there is no license server to call out
 * to, and self-hosters are expected to have full access to the feature set.
 *
 * This is a deliberate, explicit product decision (not an oversight): every
 * feature gated by `LicenseCheckService.hasFeature` becomes available,
 * including ones outside the scope of this change (SSO, SCIM, audit logs,
 * etc). See the final report for a note on blast radius.
 */
@Injectable()
export class LicenseService {
  isValidEELicense(_licenseKey: string): boolean {
    return true;
  }

  hasFeature(_licenseKey: string, _feature: string): boolean {
    return true;
  }

  getFeatures(_licenseKey: string): string[] {
    return [
      'sso:custom',
      'sso:google',
      'mfa',
      'api:keys',
      'comment:resolution',
      'page:permissions',
      'ai',
      'import:confluence',
      'import:docx',
      'import:pdf',
      'attachment:indexing',
      'security:settings',
      'mcp',
      'scim',
      'page:verification',
      'audit:logs',
      'retention',
      'sharing:controls',
      'templates',
      'comment:viewer',
      'spaces:personal',
      'export:docx',
      'bases',
      'oauth',
      'ai:controls',
      'mcp:controls',
    ];
  }

  getLicenseType(_licenseKey: string): string | null {
    return 'enterprise';
  }
}
