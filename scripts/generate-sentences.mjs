import { writeFileSync } from 'node:fs';

const cases = [];
const subjects = ['Dad', 'Sam', 'She', 'The cat', 'The sheep', 'The fish'];
const objects = ['a book', 'a boat', 'a cat', 'a fish', 'a sheep', 'the moon', 'the shop', 'the ship'];
for (const subject of subjects) {
  for (const object of objects) cases.push({ text: `${subject} can see ${object}.`, kind: 'supported-vocabulary' });
}
for (const subject of subjects) {
  for (const location of ['in the shop', 'on the ship', 'on the boat']) cases.push({ text: `${subject} is ${location}.`, kind: 'supported-vocabulary' });
}
for (const text of ['Hello, Dad!', 'Hello, Sam!', 'The cat sat on the mat.', 'Sam sat on the mat.', 'Dad can see a chip.', 'A book is on the mat.', 'A chip is on the mat.', 'A sheep sat on the mat.', 'She sat on the mat.']) {
  cases.push({ text, kind: 'supported-vocabulary' });
}
// These are broader coverage probes,
// including unexercised sounds, heteronyms, reductions and split digraphs.
const challenges = [
  ['The red hen can run.'],
  ['Chip can jump with Dad.'],
  ['The judge chose a giant peach.'],
  ['We can sing a song.'],
  ['Yes, the yellow yak can yawn.'],
  ['Put the blue book in the room.'],
  ['She can make a cake.'],
  ['I can read this book.'],
  ['Yesterday I read this book.'],
  ['The wind is cold.'],
  ['Wind the clock.'],
  ['She has a little toy.'],
  ['The boy found a coin.'],
  ['The cow is loud.'],
  ['Her bird sat near the door.'],
  ['Dad gave the girl a cube.'],
  ['A bright light is in the sky.'],
  ['The city has a gym.'],
  ['A knife is on the shelf.'],
  ['Two boxes are on the mat.'],
  ["This cat can't swim."],
  ['The school is quiet.'],
  ['The chief eats bread.'],
  ['The snow is on the ground.'],
  ['She likes music.'],
];
for (const [text] of challenges) cases.push({ text, kind: 'coverage-challenge' });
if (cases.length !== 100 || new Set(cases.map(row => row.text)).size !== 100) throw new Error('Expected exactly 100 distinct sentences.');
writeFileSync(new URL('../evaluation/sentences.json', import.meta.url), JSON.stringify(cases.map((row, index) => ({ id: index + 1, ...row })), null, 2) + '\n');
console.log('Generated 100 distinct sentences: 75 supported-vocabulary cases and 25 coverage challenges.');
