import type { Gender } from './types';

// English pronoun set used across the memorial UI. The property names
// map to grammatical role, which keeps substitution unambiguous even
// where English surface forms overlap (e.g. "her" is both object and
// possessive; "his" is both possessive-determiner and
// possessive-pronoun). Call sites pick the role, not the surface form.
export interface Pronouns {
  // "he kept a garden" / "she kept a garden" / "they kept a garden"
  subject: string;
  // "we miss him" / "we miss her" / "we miss them"
  object: string;
  // "his garden" / "her garden" / "their garden" — determiner form
  possessive: string;
  // "the garden is his" / "hers" / "theirs" — pronoun form
  possessivePronoun: string;
  // "he taught himself" / "she taught herself" / "they taught themself"
  reflexive: string;
  // "he is / she is / they are" — only verb that disagrees between the
  // singular pronouns and singular-they, so keep it on the record.
  isVerb: string;
}

export function pronounsFor(gender: Gender | undefined | null): Pronouns {
  switch (gender) {
    case 'male':
      return {
        subject: 'he',
        object: 'him',
        possessive: 'his',
        possessivePronoun: 'his',
        reflexive: 'himself',
        isVerb: 'is',
      };
    case 'female':
      return {
        subject: 'she',
        object: 'her',
        possessive: 'her',
        possessivePronoun: 'hers',
        reflexive: 'herself',
        isVerb: 'is',
      };
    // Nonbinary and unspecified both fall through to singular they.
    default:
      return {
        subject: 'they',
        object: 'them',
        possessive: 'their',
        possessivePronoun: 'theirs',
        reflexive: 'themself',
        isVerb: 'are',
      };
  }
}

export function capitalize(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}
