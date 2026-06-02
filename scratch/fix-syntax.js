import fs from 'fs';
import path from 'path';

function fixSyntax(dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  for (const file of files) {
    const p = path.join(dir, file);
    let content = fs.readFileSync(p, 'utf8');

    // Fix export default async function(req, res) => { to export default async (req, res) => {
    content = content.replace(/export default async function\(([^)]*)\)\s*=>/g, "export default async ($1) =>");

    fs.writeFileSync(p, content, 'utf8');
    console.log('Fixed syntax in', p);
  }
}

fixSyntax('./api/_endpoints');
fixSyntax('./api/_lib');
