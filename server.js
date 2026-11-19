/** Entry point: `npm start` */
const db = require('./src/db');
const { createApp } = require('./src/app');
const { seed } = require('./src/seed');
const config = require('./src/config');

// First run: fill the empty database with demo data so the app is ready to explore.
const hasUsers = db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
if (!hasUsers) {
  seed();
  console.log('Demo data created.');
}

const PORT = config.port;
createApp().listen(PORT, () => {
  console.log(`\n  Haat is running at  ${config.mainUrl}`);
  console.log(`  Every store has its own sub-domain, e.g. ${config.storeUrl('cha-ghar')}\n`);
  console.log('  Admin login :  admin@haat.local      / admin1234');
  console.log('  Tenant login:  rina@chaghar.in       / password123');
  console.log('                 sourav@matirkaaj.in   / password123');
  console.log('                 pallab@boipara.in     / password123\n');
});
