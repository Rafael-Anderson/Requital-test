import { IsString } from 'class-validator';

// content is rich-text HTML from the shared RichTextEditor (same
// contentEditable-sourced HTML as product descriptions) — no separate
// sanitization here, matching the existing convention (product.description
// is saved the same way, trusted merchant-authored content rendered only to
// that merchant's own shoppers, not user-generated content from strangers).
export class UpsertPolicyPageDto {
  @IsString()
  content!: string;
}
