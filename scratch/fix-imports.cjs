const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'api', '_endpoints');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));

files.forEach(f => {
  const filePath = path.join(dir, f);
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.includes("from '../_lib/adminAuth'")) {
    content = content.replace(/from '\.\.\/_lib\/adminAuth'/g, "from '../_lib/adminAuth.js'");
    fs.writeFileSync(filePath, content);
    console.log(`Updated ${f}`);
  }
});
