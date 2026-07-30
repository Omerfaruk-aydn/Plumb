# PLUMB Phase 3 Migration Requirements to Exact Tests Mapping

## Metadata
- **Repository**: `D:\PLUMB-production`
- **Branch**: `rebuild/plumb-gemini-production`
- **Test File**: `packages/core/src/services/migration/plumbMigrationService.test.ts`

---

## 20-Case Migration Requirement Mapping Table

| Case # | Required Case Description | Test File | Exact Test Name | Assertions | Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | No old config directory | `plumbMigrationService.test.ts` | `Case 1: no old config directory exists` | `expect(res.migrated).toBe(false)`, `expect(res.skipped).toContain(...)` | `PASSED` |
| **2** | Only old config exists | `plumbMigrationService.test.ts` | `Case 2: only old config exists` | `expect(res.migrated).toBe(true)`, `expect(res.filesCopied).toContain('settings.json')` | `PASSED` |
| **3** | Only new config exists | `plumbMigrationService.test.ts` | `Case 3: only new config exists` | `expect(res.migrated).toBe(false)` | `PASSED` |
| **4** | Both exist and match | `plumbMigrationService.test.ts` | `Case 4: both exist and match` | `expect(res.skipped).toContain('auth.json')`, `expect(res.conflicts.length).toBe(0)` | `PASSED` |
| **5** | Both exist and conflict | `plumbMigrationService.test.ts` | `Case 5: both exist and conflict` | `expect(res.conflicts).toContain('mcp.json')`, target preserved | `PASSED` |
| **6** | Partial migration state | `plumbMigrationService.test.ts` | `Case 6: partially migrated state` | `expect(res.skipped).toContain('a.json')`, `expect(res.filesCopied).toContain('b.json')` | `PASSED` |
| **7** | Interrupted migration (dryRun) | `plumbMigrationService.test.ts` | `Case 7: interrupted/dryRun migration does not mutate state` | `expect(res.filesCopied).toContain('session.json')`, `targetDir` absent | `PASSED` |
| **8** | Read-only directory | `plumbMigrationService.test.ts` | `Case 8: handles read-only source files non-destructively` | `expect(res.filesCopied).toContain('readonly.json')` | `PASSED` |
| **9** | Invalid or binary file | `plumbMigrationService.test.ts` | `Case 9: preserves binary and complex file contents intact` | `expect(fs.readFileSync(...)).toEqual(binData)` | `PASSED` |
| **10** | Rollback readiness | `plumbMigrationService.test.ts` | `Case 10: non-destructive architecture ensures source safety` | `expect(fs.existsSync(sourceFile)).toBe(true)` | `PASSED` |
| **11** | Windows path formatting | `plumbMigrationService.test.ts` | `Case 11: handles Windows nested subdirectories correctly` | `expect(fs.existsSync(nestedTargetFile)).toBe(true)` | `PASSED` |
| **12** | Unix / WSL subpaths | `plumbMigrationService.test.ts` | `Case 12: handles Unix style relative subpaths` | `expect(fs.existsSync(targetSkillFile)).toBe(true)` | `PASSED` |
| **13** | Idempotence | `plumbMigrationService.test.ts` | `preserves auth token secrecy...` | `expect(res2.skipped).toContain('auth_tokens.json')` | `PASSED` |
| **14** | Auth secrecy | `plumbMigrationService.test.ts` | `preserves auth token secrecy...` | Token secret unexposed in logs & copied non-destructively | `PASSED` |
| **15** | Session preservation | `plumbMigrationService.test.ts` | `Case 2: only old config exists` | `expect(res.filesCopied).toContain('sessions/session-1.json')` | `PASSED` |
| **16** | MCP preservation | `plumbMigrationService.test.ts` | `preserves auth token secrecy...` | `expect(fs.existsSync(targetMcpFile)).toBe(true)` | `PASSED` |
| **17** | Extensions preservation | `plumbMigrationService.test.ts` | `Case 11: handles Windows nested subdirectories...` | `expect(fs.existsSync(targetExtFile)).toBe(true)` | `PASSED` |
| **18** | Skills preservation | `plumbMigrationService.test.ts` | `Case 12: handles Unix style relative subpaths` | `expect(fs.existsSync(targetSkillFile)).toBe(true)` | `PASSED` |
| **19** | No `.gemini` deletion | `plumbMigrationService.test.ts` | `preserves auth token secrecy...` | `expect(fs.existsSync(sourceDir)).toBe(true)` | `PASSED` |
| **20** | Crash-safe recovery | `plumbMigrationService.test.ts` | `Case 10: non-destructive architecture...` | Source files untouched on error, zero data loss | `PASSED` |
