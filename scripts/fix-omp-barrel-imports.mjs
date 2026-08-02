import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] || 'D:/PLUMB-production/packages/provider/dist/omp-ai';

function fixFile(filePath) {
  let content = readFileSync(filePath, 'utf8');
  const original = content;
  const inRegistry = filePath.includes('/registry/') || filePath.includes('\\registry\\');
  const inError = filePath.includes('/error/') || filePath.includes('\\error\\');
  
  // Fix barrel imports: error/ is a directory
  if (!inError) {
    content = content.replace(/from\s+["']\.\.\/error\.js["'];?/g, 'from "../error/index.js";');
    content = content.replace(/from\s+["']\.\/error\.js["'];?/g, 'from "./error/index.js";');
  }
  content = content.replace(/from\s+["']\.\.\/utils\/schema\.js["'];?/g, 'from "../utils/schema/index.js";');
  
  // Fix registry barrel
  if (inRegistry) {
    // In registry/ directory: keep ./registry.js as-is (it's a file, not a barrel)
    content = content.replace(/from\s+["']\.\/registry\/index\.js["'];?/g, 'from "./registry.js";');
    content = content.replace(/from\s+["']\.\/oauth\.js["'];?/g, 'from "./oauth/index.js";');
  } else {
    content = content.replace(/from\s+["']\.\/registry\.js["'];?/g, 'from "./registry/index.js";');
    content = content.replace(/from\s+["']\.\/oauth\.js["'];?/g, 'from "./oauth/index.js";');
  }
  
  // Fix incorrect barrel: error/ has oauth.ts file, not oauth/ directory
  if (inError) {
    content = content.replace(/from\s+["']\.\/oauth\/index\.js["'];?/g, 'from "./oauth.js";');
  }

  // NOTE: JSON imports (`with { type: "json" }`) and `bun` imports are NOT
  // rewritten here anymore. JSON imports are native on Node 24 and the
  // previous rewrite was semantically broken (basename-only paths). Bun
  // imports are handled at the source level (see omp-shims/bun-runtime.ts
  // and the auth-broker removal).
  content = content.replace(
    /from\s+["']\.\.\/omp-catalog\/([^"']+)["'];?/g,
    (match, sub) => {
      if (sub === 'provider-models.js') return 'from "../omp-catalog/provider-models/index.js";';
      if (sub === 'compat.js') return 'from "../omp-catalog/compat/index.js";';
      if (sub === 'discovery.js') return 'from "../omp-catalog/discovery/index.js";';
      if (sub === 'identity.js') return 'from "../omp-catalog/identity/index.js";';
      return `from "../omp-catalog/${sub}";`;
    }
  );
  
  if (content !== original) {
    writeFileSync(filePath, content);
    return true;
  }
  return false;
}

function walkDir(dirPath) {
  let fixed = 0;
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) fixed += walkDir(fullPath);
    else if (entry.name.endsWith('.js')) {
      if (fixFile(fullPath)) fixed++;
    }
  }
  return fixed;
}

console.log(`Fixed ${walkDir(dir)} files`);
