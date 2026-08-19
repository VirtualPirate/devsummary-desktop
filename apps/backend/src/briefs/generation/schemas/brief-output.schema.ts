import { WORK_CATEGORIES } from '@launchstack/api-interfaces';
import { z } from 'zod';

export const BriefHighlightSchema = z.object({
  title: z.string().min(1).max(120),
  detail: z.string().min(1).max(240),
  // Required here, optional on `BriefHighlight`: the model must always pick
  // one, but rows stored before this field existed have to keep reading back.
  // The same five values the charts bucket into, so a tag and a bar cannot
  // disagree about what counts as a fix.
  category: z.enum(WORK_CATEGORIES),
});

export const BriefOutputSchema = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(1200),
  // Deliberately uncapped: the right number is however many outcomes in the
  // period actually matter. A cap would force the model to drop a real
  // highlight from a busy week, and a floor would make it invent one for a
  // quiet week. Selectivity is the prompt's job, not the schema's.
  highlights: z.array(BriefHighlightSchema),
});

export type BriefOutput = z.infer<typeof BriefOutputSchema>;
