// Creates the first super admin on a new (live) copy, where no sample data is added.
// Usage: npm run make-admin -- "Full Name" username 98XXXXXXXX
// The password is shown once here; it must be changed at first login.
const D = require('./db');
const L = require('./logic');

const [name, username, phone] = process.argv.slice(2);
if (!name || !username || !L.validPhone(L.digits10(phone))) {
  console.log('Usage: npm run make-admin -- "Full Name" username 98XXXXXXXX');
  process.exit(1);
}
if (D.get('SELECT 1 FROM users WHERE username=?', username)) { console.log(`The username ${username} is already used.`); process.exit(1); }
const pw = L.newPassword();
const id = D.nextId('U');
D.insert('users', { id, name, whatsapp: L.digits10(phone), level: 'super', agency_id: null, role: 'Head office', username, pass_hash: L.hashPassword(pw), status: 'On', must_change: 1, failed: 0, created_by: 'make-admin', created_at: D.now() });
D.history('make-admin', 'create login', id, null, null, `${username} (super)`);
console.log(`Super admin ${id} created. Username: ${username}  Password (shown once): ${pw}`);
