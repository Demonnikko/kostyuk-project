const fs = require('fs');
const path = require('path');

const dir = path.join(process.cwd(), 'api', '_endpoints');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));

files.forEach(f => {
  const filePath = path.join(dir, f);
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.includes("../_lib/")) {
    content = content.replace(/\.\.\/_lib\//g, "../../shared/");
    fs.writeFileSync(filePath, content);
    console.log('Updated ' + f);
  }
});
