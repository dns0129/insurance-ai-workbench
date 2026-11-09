import {openDatabase} from '../db.mjs';
import {mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const db=openDatabase(join(root,'data/insurance.sqlite'));
const keep=['A001','A003','A006'];
const count=db.prepare('SELECT count(*) n FROM agents').get().n;
if(count===3&&keep.every(id=>db.prepare('SELECT id FROM agents WHERE id=?').get(id))){console.log('Already using the three-agent demo.');db.close();process.exit(0);}
if(count!==200)throw new Error('Unexpected dataset; migration stopped.');
mkdirSync(join(root,'data/backups'),{recursive:true});
const backup=join(root,'data/backups','before-three-agents-'+Date.now()+'.sqlite');
db.prepare('VACUUM INTO ?').run(backup);
db.exec('BEGIN IMMEDIATE');
try{
  db.exec("DELETE FROM sessions; DELETE FROM policies WHERE agent_id NOT IN ('A001','A003','A006'); DELETE FROM clients WHERE agent_id NOT IN ('A001','A003','A006'); DELETE FROM agents WHERE id NOT IN ('A001','A003','A006');");
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Foreign key check failed');
  db.exec('COMMIT');
}catch(e){db.exec('ROLLBACK');throw e;}
console.log(JSON.stringify({backup,agents:db.prepare('SELECT id,name FROM agents').all(),policies:db.prepare('SELECT count(*) n FROM policies').get().n}));
db.close();
