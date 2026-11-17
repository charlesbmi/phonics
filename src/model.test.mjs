import assert from 'node:assert/strict';
import test from 'node:test';
import { tokenize, hintsVisible, soundAtClientX, hasBlendingCues, soundEvents, soundCueBounds, groupSoundIndices } from './model.ts';

import { buildDictionary } from '../scripts/build-dictionary.mjs';
const dictionary = buildDictionary();

test('repeated words retain separate occurrences and exact original text', () => {
  const source = "Dad, Dad!\nShe sees café. It's hello.";
  const tokens = tokenize(source);
  assert.equal(tokens.map(token => token.text).join(''), source);
  assert.deepEqual(tokens.filter(token => token.word).map(token => [token.text, token.occurrence]), [
    ['Dad', 0], ['Dad', 1], ['She', 2], ['sees', 3], ['café', 4], ["It's", 5], ['hello', 6],
  ]);
});

test('per-occurrence Show and Hide override the global default', () => {
  assert.equal(hintsVisible(false, 'show'), true);
  assert.equal(hintsVisible(true, 'hide'), false);
  assert.equal(hintsVisible(true, 'default'), true);
  assert.equal(hintsVisible(false, 'default'), false);
});

test('scrubbing follows unequal grapheme widths and clamps beyond endpoints', () => {
  const rightEdges = [30, 90, 120];
  assert.equal(soundAtClientX(-20, rightEdges), 0);
  assert.equal(soundAtClientX(35, rightEdges), 1);
  assert.equal(soundAtClientX(80, rightEdges), 1);
  assert.equal(soundAtClientX(120, rightEdges), 2);
  assert.equal(soundAtClientX(160, rightEdges), 2);
});

test('dictionary entries cover their spelling with explicit supported cue data', () => {
  for (const [word, entry] of Object.entries(dictionary.words)) {
    assert.equal(entry.groups.map(group => group.text).join(''), word);
    assert.ok(entry.groups.length > 0);
    let offset = 0;
    const bounds = entry.groups.map(group => { const left = offset; offset += group.text.length; return { left, right: offset }; });
    const cells = soundCueBounds(entry, bounds);
    assert.equal(cells.length, soundEvents(entry).length);
    cells.forEach((cell, index) => {
      assert.ok(Number.isFinite(cell.left) && cell.width > 0, `${word}: invalid sound cell`);
      if (index) assert.ok(cells[index - 1].left + cells[index - 1].width <= cell.left + 1e-6, `${word}: overlapping hit cells`);
    });
    for (const group of entry.groups) {
      assert.ok([null, 'quick', 'stretch'].includes(group.cue), `${word}: invalid cue`);
      assert.equal(group.phoneme.length === 0, !!group.silent, `${word}: silent and sounding spans stay distinct`);
      assert.ok([null, 'short', 'long', 'reduced', 'other'].includes(group.vowel));
    }
  }
  // Duration and conventional long-vowel marks encode different things.
  assert.equal(dictionary.words.dad.groups[1].cue, 'stretch');
  assert.equal(dictionary.words.dad.groups[1].vowel, 'short');
  assert.equal(dictionary.words.moon.groups[1].vowel, 'other');
  assert.equal(hasBlendingCues(dictionary.words.sheep), true);
  assert.equal(hasBlendingCues(dictionary.words.hello), true);
  assert.equal(hasBlendingCues(undefined), false);
});

test('silent spans have no sound event and multiple phones share one letter span', () => {
  const entry = { groups: [
    {text:'b',phoneme:'b',cue:'quick',vowel:null},
    {text:'o',phoneme:'ɑ',cue:'stretch',vowel:'short'},
    {text:'x',phoneme:'ks',cue:null,vowel:null},
    {text:'e',phoneme:'',cue:null,vowel:null,silent:true},
  ], sounds: [
    {phoneme:'b',cue:'quick',vowel:null,groupIndices:[0]},
    {phoneme:'ɑ',cue:'stretch',vowel:'short',groupIndices:[1]},
    {phoneme:'k',cue:'quick',vowel:null,groupIndices:[2]},
    {phoneme:'s',cue:'stretch',vowel:null,groupIndices:[2]},
  ]};
  assert.equal(soundEvents(entry).length,4);
  assert.equal(hasBlendingCues(entry),true);
  assert.deepEqual(soundCueBounds(entry,[{left:0,right:30},{left:30,right:60},{left:60,right:90},{left:90,right:120}]),[
    {left:0,width:30},{left:30,width:30},{left:60,width:15},{left:75,width:15},
  ]);
});

test('split spellings share progress links and overlapping sound windows stay selectable', () => {
  const entry = { groups: [
    {text:'a',vowel:'long'},{text:'k',vowel:null},{text:'e',vowel:null,silent:true},
  ], sounds: [
    {phoneme:'eɪ',cue:'stretch',vowel:'long',groupIndices:[0]},
    {phoneme:'k',cue:'quick',vowel:null,groupIndices:[1]},
  ],teachingUnits:[{groupIndices:[0,2],phoneIndices:[0],letterIndices:[0,2],patternId:'split-a-e',phoneme:'eɪ',vowel:'long',evidence:'source'}] };
  assert.deepEqual(groupSoundIndices(entry,2),[0]);
  const overlapping={...entry,teachingUnits:[],sounds:[
    {...entry.sounds[0],groupIndices:[0,1]},
    {...entry.sounds[1],groupIndices:[1,2]},
  ]};
  assert.deepEqual(soundCueBounds(overlapping,[{left:0,right:30},{left:30,right:60},{left:60,right:90}]),[{left:0,width:45},{left:45,width:45}]);
});
