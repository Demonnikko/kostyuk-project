import fs from 'fs';
import path from 'path';

function convertToEsm(dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  for (const file of files) {
    const p = path.join(dir, file);
    let content = fs.readFileSync(p, 'utf8');

    // Convert const { x } = require('y') to import { x } from 'y'
    content = content.replace(/const\s+\{([^}]+)\}\s*=\s*require\(['"]([^'"]+)['"]\);?/g, "import { $1 } from '$2';");
    
    // Convert const x = require('y') to import x from 'y'
    content = content.replace(/const\s+([a-zA-Z0-9_]+)\s*=\s*require\(['"]([^'"]+)['"]\);?/g, "import $1 from '$2';");

    // Convert module.exports = ...
    content = content.replace(/module\.exports\s*=\s*async\s+function\s+handler\s*\(/g, "export default async function handler(");
    content = content.replace(/module\.exports\s*=\s*async\s*\(/g, "export default async function(");
    content = content.replace(/module\.exports\s*=\s*\{/g, "export {");
    
    // Quick fix for named exports if they were module.exports = { a, b } -> export { a, b }
    
    fs.writeFileSync(p, content, 'utf8');
    console.log('Converted', p);
  }
}

convertToEsm('./api/_endpoints');
convertToEsm('./api/_lib');
