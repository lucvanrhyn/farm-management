import { createClient } from "@libsql/client";

async function main() {
  const client = createClient({
    url: process.env.META_TURSO_URL!,
    authToken: process.env.META_TURSO_AUTH_TOKEN!,
  });
  
  const result = await client.execute({
    sql: "SELECT id, email, username, name, email_verified, verification_token FROM users WHERE username = ? OR email = ? LIMIT 5",
    args: ["luc", "luc"],
  });
  console.log("Users found:", result.rows.length);
  for (const row of result.rows) {
    console.log(JSON.stringify({ ...row, verification_token: row.verification_token ? "[SET]" : null }));
  }
}
main().catch(console.error);
