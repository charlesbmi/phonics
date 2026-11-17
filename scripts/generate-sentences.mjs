import { writeFileSync } from 'node:fs';

const cases = [];
const subjects = ['Dad', 'Sam', 'She', 'The cat', 'The sheep', 'The fish'];
const objects = ['a book', 'a boat', 'a cat', 'a fish', 'a sheep', 'the moon', 'the shop', 'the ship'];
for (const subject of subjects) {
  for (const object of objects) cases.push({ text: `${subject} can see ${object}.`, kind: 'supported-vocabulary', expectedUnmapped: [] });
}
for (const subject of subjects) {
  for (const location of ['in the shop', 'on the ship', 'on the boat']) cases.push({ text: `${subject} is ${location}.`, kind: 'supported-vocabulary', expectedUnmapped: [] });
}
for (const text of ['Hello, Dad!', 'Hello, Sam!', 'The cat sat on the mat.', 'Sam sat on the mat.', 'Dad can see a chip.', 'A book is on the mat.', 'A chip is on the mat.', 'A sheep sat on the mat.', 'She sat on the mat.']) {
  cases.push({ text, kind: 'supported-vocabulary', expectedUnmapped: [] });
}
// Deliberately outside the admitted word list. These are coverage probes,
// including unexercised sounds, heteronyms, reductions and split digraphs.
const challenges = [
  ['The red hen can run.', ['red', 'hen', 'run']],
  ['Chip can jump with Dad.', ['jump', 'with']],
  ['The judge chose a giant peach.', ['judge', 'chose', 'giant', 'peach']],
  ['We can sing a song.', ['we', 'sing', 'song']],
  ['Yes, the yellow yak can yawn.', ['yes', 'yellow', 'yak', 'yawn']],
  ['Put the blue book in the room.', ['put', 'blue', 'room']],
  ['She can make a cake.', ['make', 'cake']],
  ['I can read this book.', ['i', 'read', 'this']],
  ['Yesterday I read this book.', ['yesterday', 'i', 'read', 'this']],
  ['The wind is cold.', ['wind', 'cold']],
  ['Wind the clock.', ['wind', 'clock']],
  ['She has a little toy.', ['has', 'little', 'toy']],
  ['The boy found a coin.', ['boy', 'found', 'coin']],
  ['The cow is loud.', ['cow', 'loud']],
  ['Her bird sat near the door.', ['her', 'bird', 'near', 'door']],
  ['Dad gave the girl a cube.', ['gave', 'girl', 'cube']],
  ['A bright light is in the sky.', ['bright', 'light', 'sky']],
  ['The city has a gym.', ['city', 'has', 'gym']],
  ['A knife is on the shelf.', ['knife', 'shelf']],
  ['Two boxes are on the mat.', ['two', 'boxes', 'are']],
  ["This cat can't swim.", ['this', "can't", 'swim']],
  ['The school is quiet.', ['school', 'quiet']],
  ['The chief eats bread.', ['chief', 'eats', 'bread']],
  ['The snow is on the ground.', ['snow', 'ground']],
  ['She likes music.', ['likes', 'music']],
];
for (const [text, expectedUnmapped] of challenges) cases.push({ text, kind: 'coverage-challenge', expectedUnmapped });
if (cases.length !== 100 || new Set(cases.map(row => row.text)).size !== 100) throw new Error('Expected exactly 100 distinct sentences.');
writeFileSync(new URL('../evaluation/sentences.json', import.meta.url), JSON.stringify(cases.map((row, index) => ({ id: index + 1, ...row })), null, 2) + '\n');
console.log('Generated 100 distinct sentences: 75 supported-vocabulary cases and 25 coverage challenges.');
