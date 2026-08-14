import assert from 'node:assert/strict';
import { test } from 'node:test';

import { learningKey, suggestCategory } from '../categorise';

test('brand names are recognised', () => {
  assert.equal(suggestCategory('Zomato'), 'food');
  assert.equal(suggestCategory('swiggy order'), 'food');
  assert.equal(suggestCategory('Blinkit'), 'groceries');
  assert.equal(suggestCategory('Zepto late night'), 'groceries');
  assert.equal(suggestCategory('Uber to office'), 'transport');
  assert.equal(suggestCategory('Netflix'), 'entertainment');
  assert.equal(suggestCategory('Amazon order'), 'shopping');
  assert.equal(suggestCategory('IRCTC'), 'travel');
});

test('plain words work as well as brands', () => {
  assert.equal(suggestCategory('Dhaba dinner'), 'food');
  assert.equal(suggestCategory('Room rent'), 'home');
  assert.equal(suggestCategory('petrol'), 'transport');
  assert.equal(suggestCategory('electricity bill'), 'utilities');
  assert.equal(suggestCategory('movie ticket'), 'entertainment');
});

test('dates and noise words do not drown out the real signal', () => {
  // Straight from the real ledger: the month and the number say when, not what.
  assert.equal(suggestCategory('Auto till 12 aug'), 'transport');
  assert.equal(suggestCategory('Fridge and wn rent till 22july'), 'home');
  assert.equal(suggestCategory("Rent - July'25"), 'home');
});

test('a longer phrase beats the shorter word inside it', () => {
  // "hotel" alone means a restaurant in much of India; the booking does not.
  assert.equal(suggestCategory('Hotel booking for Goa'), 'travel');
  assert.equal(suggestCategory('water bill'), 'utilities');
});

test('matching is on whole words, never substrings', () => {
  // 'ola' inside 'chocolate', 'gas' inside 'gasket'.
  assert.notEqual(suggestCategory('chocolate'), 'transport');
  assert.notEqual(suggestCategory('gasket'), 'utilities');
});

test('singular and plural are the same word', () => {
  // The reported bug: "vegetables" was in the list, "vegetable" was not.
  assert.equal(suggestCategory('vegetable'), 'groceries');
  assert.equal(suggestCategory('vegetables'), 'groceries');
  assert.equal(suggestCategory('egg'), 'groceries');
  assert.equal(suggestCategory('eggs'), 'groceries');
  assert.equal(suggestCategory('shoe'), 'shopping');
  assert.equal(suggestCategory('shoes'), 'shopping');
  assert.equal(suggestCategory('groceries'), 'groceries');
});

test('the words that were missing entirely', () => {
  assert.equal(suggestCategory('Chicken'), 'groceries');
  assert.equal(suggestCategory('eatsure'), 'food');
  assert.equal(suggestCategory('mutton'), 'groceries');
  assert.equal(suggestCategory('cake'), 'food');
});

test('misspellings still land somewhere sensible', () => {
  assert.equal(suggestCategory('vegetabel'), 'groceries');
  assert.equal(suggestCategory('groceris'), 'groceries');
  assert.equal(suggestCategory('resturant'), 'food');
  assert.equal(suggestCategory('electricty'), 'utilities');
  assert.equal(suggestCategory('zomatoo'), 'food');
});

test('nothing recognisable returns null rather than guessing', () => {
  assert.equal(suggestCategory('Mada'), null);
  assert.equal(suggestCategory('xyz123'), null);
  assert.equal(suggestCategory(''), null);
  assert.equal(suggestCategory('   '), null);
});

test('case and punctuation are irrelevant', () => {
  assert.equal(suggestCategory('ZOMATO!!!'), 'food');
  assert.equal(suggestCategory('  swiggy,  dinner  '), 'food');
});

test('sports is recognised', () => {
  assert.equal(suggestCategory('gym membership'), 'sports');
  assert.equal(suggestCategory('Decathlon'), 'sports');
  assert.equal(suggestCategory('badminton court'), 'sports');
  assert.equal(suggestCategory('cricket match'), 'sports');
  assert.equal(suggestCategory('cultfit'), 'sports');
});

test('a learned correction beats every heuristic', () => {
  // "Tuesday regulars" means nothing to the vocabulary...
  assert.equal(suggestCategory('Tuesday regulars'), null);
  const learned = { [learningKey('Tuesday regulars')]: 'food' };
  assert.equal(suggestCategory('Tuesday regulars', learned), 'food');

  // ...and a correction overrides even an unambiguous brand.
  const override = { [learningKey('Zomato')]: 'groceries' };
  assert.equal(suggestCategory('Zomato', override), 'groceries');
});

test('the learning key ignores word order and noise', () => {
  assert.equal(learningKey('Zomato dinner'), learningKey('dinner from Zomato'));
  assert.equal(learningKey('Room rent'), learningKey('rent for the room'));
  // Different words are still different lessons.
  assert.notEqual(learningKey('Zomato dinner'), learningKey('Zomato lunch'));
});
