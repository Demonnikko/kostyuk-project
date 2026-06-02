import fs from 'fs';
import path from 'path';

const dir = './api/_endpoints';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));

for (const file of files) {
  const p = path.join(dir, file);
  let content = fs.readFileSync(p, 'utf8');
  
  // Replace require('./_someThing') with require('../_lib/someThing')
  content = content.replace(/require\(['"]\.\/_([a-zA-Z0-9_]+)['"]\)/g, "require('../_lib/$1')");
  
  // Replace require('./_lib/someThing') with require('../_lib/someThing')
  content = content.replace(/require\(['"]\.\/_lib\/([a-zA-Z0-9_]+)['"]\)/g, "require('../_lib/$1')");

  fs.writeFileSync(p, content, 'utf8');
  console.log('Fixed', file);
}
