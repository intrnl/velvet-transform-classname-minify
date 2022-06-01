import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileSync } from '@intrnl/velvet-compiler';
import classname_minify from '../src/index.js';


let __filename = fileURLToPath(import.meta.url);
let __dirname = path.dirname(__filename);
let template = fs.readFileSync(path.join(__dirname, './todomvc.velvet'), 'utf-8');

let result = compileSync(template, {
	transformers: [
		classname_minify(),
	],
});

console.log(result);
