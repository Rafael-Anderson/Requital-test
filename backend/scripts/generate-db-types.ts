// One-time codegen: parses prisma/schema.prisma into backend/src/db/types.ts
// so the mysql2 migration keeps per-model TypeScript types without Prisma
// generating them. Run once (`npx ts-node scripts/generate-db-types.ts`),
// commit the output, then this script itself can be deleted — it is not
// part of the build.
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const SCHEMA_PATH = join(__dirname, '..', 'prisma', 'schema.prisma');
const OUTPUT_PATH = join(__dirname, '..', 'src', 'db', 'types.ts');

const SCALAR_MAP: Record<string, string> = {
  Int: 'number',
  BigInt: 'number',
  Float: 'number',
  String: 'string',
  Boolean: 'boolean',
  DateTime: 'Date',
  Decimal: 'string', // mysql2 returns DECIMAL columns as strings (decimalNumbers: false)
  Json: 'unknown',
};

function toPascalCase(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function main() {
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  const modelBlocks = [...schema.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)];

  const interfaces: string[] = [];

  for (const match of modelBlocks) {
    const [, modelName, body] = match;
    const fields: string[] = [];

    for (const rawLine of body.split('\n')) {
      const line = rawLine.replace(/\/\/.*$/, '').trim();
      if (!line || line.startsWith('@@')) continue;

      const fieldMatch = /^(\w+)\s+(\w+)(\?)?(\[\])?/.exec(line);
      if (!fieldMatch) continue;
      const [, fieldName, prismaType, optional, isArray] = fieldMatch;
      if (isArray) continue; // relation list (or unsupported scalar array) — skip
      const tsType = SCALAR_MAP[prismaType];
      if (!tsType) continue; // not a known scalar => relation field, skip

      fields.push(`  ${fieldName}: ${tsType}${optional ? ' | null' : ''};`);
    }

    interfaces.push(
      `export interface ${toPascalCase(modelName)}Row {\n${fields.join('\n')}\n}`,
    );
  }

  const output = `// AUTO-GENERATED ONCE from prisma/schema.prisma by scripts/generate-db-types.ts.
// schema.prisma has since been removed — this file is now the source of
// truth for row shapes. Edit by hand going forward.

${interfaces.join('\n\n')}
`;

  writeFileSync(OUTPUT_PATH, output);
  console.log(`Generated ${modelBlocks.length} interfaces to ${OUTPUT_PATH}`);
}

main();
