import {test} from 'vitest';
import assert from 'node:assert/strict';
import {assertInitialImageVersion} from './image-version.mjs';
test('画像の内容を変えた同じ版では、古い画像の保存先を使わない',()=>{
 assert.throws(()=>assertInitialImageVersion({_version:1,restaurant:'before'},1,{restaurant:'after'}),/VERSION/);
 assert.doesNotThrow(()=>assertInitialImageVersion({_version:1,restaurant:'before'},2,{restaurant:'after'}));
 assert.doesNotThrow(()=>assertInitialImageVersion({_version:1,restaurant:'same'},1,{restaurant:'same'}));
 assert.doesNotThrow(()=>assertInitialImageVersion(null,1,{restaurant:'new'}));
});
