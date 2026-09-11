import { z } from 'zod';
const relativePath = z.string().min(1).max(500).refine(p => !p.startsWith('/') && !p.includes('\\') && p.split('/').every(x => x && x !== '.' && x !== '..'), 'Use an app-relative path');
export const SwiftProjectSchema = z.object({
  adapter: z.literal('swift-ios'),
  files: z.array(relativePath).min(1).max(1000),
  resources: z.array(relativePath).max(100),
  projectFile: relativePath.optional(),
  target: z.string().max(100),
  buildStrategy: z.enum(['standalone', 'xcode']).optional(),
  context: z.enum(['isolated','application']).optional(),
  buildInputs: z.array(relativePath).max(2000).optional(),
  buildNotes: z.array(z.string().max(2000)).max(100).optional(),
  buildIssues: z.array(z.string().min(1).max(2000)).max(100).optional(),
  overrides: z.record(relativePath, z.string().regex(/^lib\/[a-zA-Z0-9_./()-]+\.swift$/)).default({}),
}).strict();
export type SwiftProject = z.infer<typeof SwiftProjectSchema>;
