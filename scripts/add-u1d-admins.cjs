const { Client } = require("pg");

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  await client.connect();

  const emails = [
    "ultrachemllcmiami@gmail.com",
    "ccolarusso@ultra1plus.com",
  ];

  for (const email of emails) {
    await client.query(
      `
      INSERT INTO u1d_ops.users (email, role, is_active)
      VALUES ($1, 'admin', TRUE)
      ON CONFLICT (email)
      DO UPDATE SET role = 'admin', is_active = TRUE
      `,
      [email]
    );
  }

  const result = await client.query(`
    SELECT email, role, is_active
    FROM u1d_ops.users
    ORDER BY email
  `);

  console.table(result.rows);

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
