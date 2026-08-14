/**
 * Guess an expense's category from what it was called.
 *
 * Runs on the device, with no network call and no API key. That is a deliberate
 * trade: it has to answer on every keystroke while someone types a description,
 * and a round trip per keystroke would be both slow and expensive.
 *
 * Three passes, each more forgiving than the last, because the cost of leaving
 * something in "general" is higher than the cost of a near miss:
 *
 *  1. Phrases, longest first, so "hotel booking" beats the bare "hotel" that
 *     would otherwise file a trip as a restaurant.
 *  2. Exact word match, after stemming — "vegetable" and "vegetables" are the
 *     same word, and only one of them used to be in the list.
 *  3. Fuzzy match, for the spelling nobody gets right the first time
 *     ("groceris", "vegetabel"). Distance scales with word length so short
 *     words cannot collide with each other.
 */

/** Multi-word signals. Checked first — a phrase is stronger evidence. */
const PHRASES: [string, string][] = [
  ['hotel booking', 'travel'],
  ['room rent', 'home'],
  ['house rent', 'home'],
  ['train ticket', 'travel'],
  ['bus ticket', 'travel'],
  ['flight ticket', 'travel'],
  ['movie ticket', 'entertainment'],
  ['water bill', 'utilities'],
  ['electricity bill', 'utilities'],
  ['phone bill', 'utilities'],
  ['gas cylinder', 'utilities'],
  ['washing machine', 'home'],
  ['air india', 'travel'],
  ['big basket', 'groceries'],
  ['book my show', 'entertainment'],
  ['make my trip', 'travel'],
  ['wow momo', 'food'],
  ['country delight', 'groceries'],
];

/** Unambiguous names. Weighted above ordinary nouns. */
const BRANDS: Record<string, string[]> = {
  food: [
    'zomato', 'swiggy', 'eatsure', 'dominos', 'mcdonalds', 'kfc', 'starbucks',
    'subway', 'burgerking', 'pizzahut', 'faasos', 'behrouz', 'chaayos', 'box8',
    'freshmenu', 'haldiram', 'bikanervala', 'barbeque', 'ccd', 'dunkin',
  ],
  groceries: [
    'blinkit', 'zepto', 'instamart', 'bigbasket', 'dmart', 'grofers',
    'jiomart', 'licious', 'freshtohome', 'natures', 'reliancefresh',
  ],
  transport: ['uber', 'ola', 'rapido', 'fastag', 'shell', 'indianoil', 'bpcl', 'hpcl', 'namma'],
  travel: ['irctc', 'makemytrip', 'goibibo', 'oyo', 'airbnb', 'indigo', 'vistara', 'redbus', 'yatra', 'cleartrip'],
  utilities: ['jio', 'airtel', 'vodafone', 'bsnl', 'tatapower', 'adani', 'hathway', 'torrent'],
  entertainment: ['netflix', 'hotstar', 'spotify', 'bookmyshow', 'jiocinema', 'sonyliv', 'zee', 'pvr', 'inox'],
  shopping: ['amazon', 'flipkart', 'myntra', 'ajio', 'nykaa', 'meesho', 'ikea', 'croma', 'lenskart'],
  sports: ['decathlon', 'nike', 'adidas', 'puma', 'cult', 'cultfit', 'strava', 'reebok'],
};

const WORDS: Record<string, string[]> = {
  food: [
    'food', 'dinner', 'lunch', 'breakfast', 'brunch', 'snack', 'meal',
    'restaurant', 'cafe', 'dhaba', 'biryani', 'pizza', 'burger', 'sandwich',
    'chai', 'tea', 'coffee', 'juice', 'dessert', 'icecream', 'thali', 'tiffin',
    'mess', 'canteen', 'eatery', 'buffet', 'takeaway', 'samosa', 'dosa',
    'idli', 'paratha', 'momo', 'roll', 'shake', 'drink', 'beer', 'bar', 'pub',
    'noodles', 'pasta', 'cake', 'bakery', 'sweets', 'curry', 'kebab', 'tandoori',
    'starter', 'dining', 'feast', 'treat', 'brownie', 'pastry', 'chocolate',
  ],
  groceries: [
    'grocery', 'vegetable', 'sabzi', 'fruit', 'milk', 'egg', 'bread', 'atta',
    'rice', 'dal', 'oil', 'sugar', 'salt', 'kirana', 'supermarket',
    'provision', 'ration', 'curd', 'paneer', 'masala', 'chicken', 'mutton',
    'fish', 'prawn', 'onion', 'potato', 'tomato', 'flour', 'pulse', 'spice',
    'butter', 'cheese', 'yogurt', 'cereal', 'snacks',
  ],
  transport: [
    'auto', 'rickshaw', 'taxi', 'cab', 'metro', 'bus', 'petrol', 'diesel',
    'fuel', 'parking', 'toll', 'ride', 'commute', 'scooty', 'bike', 'fare',
    'cng', 'uberauto', 'travelcard',
  ],
  travel: [
    'flight', 'train', 'railway', 'trip', 'travel', 'hostel', 'resort',
    'holiday', 'vacation', 'tour', 'sightseeing', 'visa', 'luggage', 'stay',
  ],
  home: [
    'rent', 'maintenance', 'furniture', 'fridge', 'mattress', 'sofa', 'bed',
    'repair', 'plumber', 'carpenter', 'electrician', 'cleaning', 'appliance',
    'utensil', 'crockery', 'curtain', 'deposit', 'society', 'painting', 'broom',
  ],
  utilities: [
    'electricity', 'water', 'gas', 'internet', 'wifi', 'broadband', 'recharge',
    'bill', 'dth', 'cylinder', 'postpaid', 'prepaid', 'datapack', 'current',
  ],
  entertainment: [
    'movie', 'cinema', 'concert', 'game', 'gaming', 'subscription', 'party',
    'club', 'bowling', 'museum', 'event', 'show', 'streaming', 'outing',
  ],
  shopping: [
    'clothes', 'shirt', 'tshirt', 'jeans', 'shoe', 'sneaker', 'bag',
    'watch', 'shopping', 'mall', 'gift', 'cosmetic', 'jewellery',
    'electronics', 'headphone', 'charger', 'laptop', 'phone', 'dress',
  ],
  sports: [
    'gym', 'fitness', 'workout', 'yoga', 'membership', 'cricket', 'football',
    'badminton', 'tennis', 'swimming', 'turf', 'court', 'racket', 'racquet',
    'bat', 'ball', 'jersey', 'trek', 'trekking', 'hiking', 'cycling', 'cycle',
    'marathon', 'run', 'running', 'sport', 'coaching', 'training', 'match',
    'tournament', 'skating', 'gymnasium', 'protein', 'supplement',
  ],
};

const BRAND_WEIGHT = 6;
const WORD_WEIGHT = 2;
/** A fuzzy hit is real evidence, but never as good as spelling it right. */
const FUZZY_PENALTY = 0.5;
const MIN_SCORE = 1;

const MONTHS = new Set([
  'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
  'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september',
  'october', 'november', 'december',
]);
/**
 * Connectors only. Nothing here may double as a signal — 'bar' is food and
 * 'run' is sports, so neither belongs in this list however grammatical they
 * look. Getting this wrong silently deletes evidence.
 */
const STOP = new Set([
  'the', 'for', 'and', 'till', 'upto', 'to', 'of', 'my', 'our', 'in', 'on',
  'at', 'a', 'an', 'from', 'with', 'by', 'via', 'per', 'this', 'that', 'is',
  'was', 'we', 'us', 'me', 'you', 'they', 'them', 'his', 'her', 'its', 'it',
]);

/**
 * Crude but sufficient stemmer.
 *
 * Only has to fold the plural forms people actually type. A real stemmer would
 * bring a dependency and a pile of rules for gains this never sees — the whole
 * vocabulary is a couple of hundred concrete nouns.
 */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && (word.endsWith('ses') || word.endsWith('hes') || word.endsWith('xes'))) {
    return word.slice(0, -2);
  }
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** Levenshtein, capped: stops as soon as it cannot come in under `max`. */
function within(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      row.push(value);
      if (value < best) best = value;
    }
    if (best > max) return false;
    prev = row;
  }
  return prev[b.length] <= max;
}

/** How far off a word may be before the match stops meaning anything. */
function tolerance(word: string): number {
  if (word.length <= 4) return 0;
  if (word.length <= 7) return 1;
  return 2;
}

/** stem -> [category, weight]. Built once. */
const LOOKUP = new Map<string, [string, number][]>();
for (const [category, list] of Object.entries(BRANDS)) {
  for (const word of list) {
    const key = stem(word);
    LOOKUP.set(key, [...(LOOKUP.get(key) ?? []), [category, BRAND_WEIGHT]]);
  }
}
for (const [category, list] of Object.entries(WORDS)) {
  for (const word of list) {
    const key = stem(word);
    LOOKUP.set(key, [...(LOOKUP.get(key) ?? []), [category, WORD_WEIGHT]]);
  }
}
const KEYS = [...LOOKUP.keys()];

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(normalised: string): string[] {
  return normalised
    .split(' ')
    .filter((w) => w.length > 1 && !/^\d+$/.test(w) && !MONTHS.has(w) && !STOP.has(w))
    .map(stem);
}

/**
 * A stable key for one description, used to remember a correction.
 *
 * Significant words only, stemmed and sorted, so "Zomato dinner" and "dinner
 * from zomato" are the same key — the noise words and the ordering are exactly
 * what varies between two entries the user considers identical. Falls back to
 * the whole normalised string when nothing survives the filter, so a
 * description made only of stop words can still be learned.
 */
export function learningKey(description: string): string {
  const text = normalise(description);
  if (!text) return '';
  const words = tokens(text);
  return words.length ? [...words].sort().join(' ') : text;
}

/**
 * The best category for a description, or null when nothing is convincing.
 *
 * Null rather than 'general' on purpose: the caller needs to tell "this is
 * groceries" from "I have no idea", and only the second should leave whatever
 * the user already picked untouched.
 */
export function suggestCategory(
  description: string,
  /**
   * Corrections the user has already made, by learningKey. Consulted before
   * anything else — a category someone picked by hand for this exact
   * description beats every heuristic below it, which is the whole point.
   */
  learned: Record<string, string> = {}
): string | null {
  const text = normalise(description);
  if (!text) return null;

  const remembered = learned[learningKey(description)];
  if (remembered) return remembered;

  const byLength = [...PHRASES].sort((a, b) => b[0].length - a[0].length);
  for (const [phrase, category] of byLength) {
    if (text.includes(phrase)) return category;
  }

  const words = tokens(text);
  if (words.length === 0) return null;

  const scores = new Map<string, number>();
  const add = (category: string, points: number) =>
    scores.set(category, (scores.get(category) ?? 0) + points);

  for (const word of words) {
    const exact = LOOKUP.get(word);
    if (exact) {
      for (const [category, weight] of exact) add(category, weight);
      continue;
    }
    // Nothing matched outright, so accept the closest spelling within reach.
    const max = tolerance(word);
    if (max === 0) continue;
    let bestKey: string | null = null;
    let bestDistance = max + 1;
    for (const key of KEYS) {
      for (let d = 0; d <= max; d += 1) {
        if (d >= bestDistance) break;
        if (within(word, key, d)) {
          bestKey = key;
          bestDistance = d;
          break;
        }
      }
    }
    if (bestKey) {
      for (const [category, weight] of LOOKUP.get(bestKey)!) {
        add(category, weight * FUZZY_PENALTY);
      }
    }
  }

  let best: string | null = null;
  let bestScore = 0;
  for (const [category, score] of scores) {
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  }
  return bestScore >= MIN_SCORE ? best : null;
}
